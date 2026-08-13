import { promises as fs } from 'node:fs';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestContext } from '../src/common/context/request-context';
import { hashPassword } from '../src/modules/auth/utils/password.util';
import { cleanDatabase } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';

function bufferParser(res: request.Response, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

// A minimal, real (not fake) PDF - the "scan" the owner uploads.
const TINY_PDF = Buffer.from(
  '%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>',
  'latin1',
);

async function signupOwner(app: INestApplication, overrides: Partial<Record<string, string>> = {}) {
  const body = {
    email: 'owner@acme-fleet.test',
    password: 'password123',
    companyName: 'Acme Fleet',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '+254700000001',
    ...overrides,
  };
  const res = await request(app.getHttpServer()).post('/auth/signup').send(body).expect(201);
  const me = await request(app.getHttpServer())
    .get('/auth/me')
    .set('Authorization', `Bearer ${res.body.accessToken}`)
    .expect(200);
  return { accessToken: res.body.accessToken as string, tenantId: me.body.tenantId as string };
}

async function seedManager(prisma: PrismaService, tenantId: string) {
  await prisma.client.user.create({
    data: {
      tenantId,
      email: 'manager1@acme-fleet.test',
      phone: '+254710000099',
      passwordHash: await hashPassword('password123'),
      role: UserRole.MANAGER,
      firstName: 'Man',
      lastName: 'Ager',
    },
  });
  return { email: 'manager1@acme-fleet.test', password: 'password123' };
}

describe('OwnershipPlan (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let driverSeedCounter = 0;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = await createTestApp(moduleFixture);
    prisma = moduleFixture.get(PrismaService);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    driverSeedCounter = 0;
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
    await fs.rm(process.env.UPLOADS_DIR ?? './uploads', { recursive: true, force: true });
  });

  async function createDriverAndVehicle(accessToken: string, tag: string) {
    driverSeedCounter += 1;
    const email = `driver-${tag.toLowerCase()}-${driverSeedCounter}@test.local`;
    const driverRes = await request(app.getHttpServer())
      .post('/drivers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Juma',
        lastName: tag,
        phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
        email,
        licenseNumber: `LIC-${tag}-${driverSeedCounter}`,
        initialPassword: 'driverpass123',
      })
      .expect(201);
    const motoRes = await request(app.getHttpServer())
      .post('/motorcycles')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ registrationNumber: `REG-${tag}-${driverSeedCounter}` })
      .expect(201);
    return {
      driverId: driverRes.body.id as string,
      driverEmail: email,
      motorcycleId: motoRes.body.id as string,
    };
  }

  const planBody = (driverId: string, motorcycleId: string) => ({
    driverId,
    motorcycleId,
    dailyAmount: 12000,
    totalPrice: 1_800_000,
    startDate: '2026-03-03',
  });

  it('rejects creating a second ACTIVE plan for the same vehicle', async () => {
    const { accessToken } = await signupOwner(app);
    const { driverId: driverA, motorcycleId } = await createDriverAndVehicle(accessToken, 'A1');
    const { driverId: driverB } = await createDriverAndVehicle(accessToken, 'A2');

    await request(app.getHttpServer())
      .post('/ownership-plans')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(planBody(driverA, motorcycleId))
      .expect(201);

    await request(app.getHttpServer())
      .post('/ownership-plans')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(planBody(driverB, motorcycleId))
      .expect(409);
  });

  it("lets a DRIVER GET their own plan and rejects GET of another driver's plan", async () => {
    const { accessToken } = await signupOwner(app);
    const { driverId, driverEmail, motorcycleId } = await createDriverAndVehicle(accessToken, 'B1');
    const { driverEmail: otherEmail } = await createDriverAndVehicle(accessToken, 'B2');

    const planRes = await request(app.getHttpServer())
      .post('/ownership-plans')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(planBody(driverId, motorcycleId))
      .expect(201);

    const driverLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: driverEmail, password: 'driverpass123' })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/ownership-plans/${planRes.body.id}`)
      .set('Authorization', `Bearer ${driverLogin.body.accessToken}`)
      .expect(200);

    // Stage G4: reusing this driver login (not a fresh /auth/login call) -
    // that endpoint is rate-limited to 5/min and this file is already near
    // that ceiling. A DRIVER-role token must not be able to create an
    // excusal, even for their own plan.
    await request(app.getHttpServer())
      .post(`/ownership-plans/${planRes.body.id}/excusals`)
      .set('Authorization', `Bearer ${driverLogin.body.accessToken}`)
      .send({ excusedDate: '2026-01-01', reason: 'Should never be reachable' })
      .expect(403);

    const otherLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: otherEmail, password: 'driverpass123' })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/ownership-plans/${planRes.body.id}`)
      .set('Authorization', `Bearer ${otherLogin.body.accessToken}`)
      .expect(404);
  });

  // These are schema-level column defaults (Stage F2 Part 1), so they can
  // only be verified against a real database, not the mocked-Prisma unit
  // suite this repo otherwise uses - the spec listed them as "unit" tests,
  // but there is no way to observe a Postgres column default without a real
  // round trip. See Stage F2 report.
  it('defaults a newly created plan to all seven active weekdays and a breach threshold of 5', async () => {
    const { accessToken } = await signupOwner(app);
    const { driverId, motorcycleId } = await createDriverAndVehicle(accessToken, 'DEF1');

    const res = await request(app.getHttpServer())
      .post('/ownership-plans')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(planBody(driverId, motorcycleId))
      .expect(201);

    expect([...res.body.activeWeekdays].sort((a: number, b: number) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(res.body.breachAfterConsecutiveMissedDays).toBe(5);
  });

  describe('ledger tenant scoping (Stage G2 Part 3)', () => {
    // Confirmed from the code, not assumed: DailyAssignment carries tenantId
    // (schema.prisma), so the fail-closed Prisma extension scopes ledger()'s
    // dailyAssignment.findMany by tenant on its own; and ledger() calls
    // assertCanView(plan, actor) - which 404s on an unknown/cross-tenant plan
    // id, since OwnershipPlan.findUnique is itself tenant-scoped - before
    // that query ever runs. A user in another tenant should therefore never
    // reach the assignments query at all, and the response must be
    // indistinguishable from an unknown id: 404, not 403.
    it('returns 404, not 403, for a plan id that belongs to a different tenant', async () => {
      const { accessToken } = await signupOwner(app);
      const { driverId, motorcycleId } = await createDriverAndVehicle(accessToken, 'L1');

      const planRes = await request(app.getHttpServer())
        .post('/ownership-plans')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(planBody(driverId, motorcycleId))
        .expect(201);

      const { accessToken: otherTenantToken } = await signupOwner(app, {
        email: 'owner2@other-fleet.test',
        companyName: 'Other Fleet',
        phone: '+254700000099',
      });

      await request(app.getHttpServer())
        .get(`/ownership-plans/${planRes.body.id}/ledger`)
        .set('Authorization', `Bearer ${otherTenantToken}`)
        .expect(404);
    });
  });

  it('rejects a MANAGER creating a plan', async () => {
    const { accessToken, tenantId } = await signupOwner(app);
    const { driverId, motorcycleId } = await createDriverAndVehicle(accessToken, 'C1');
    const manager = await seedManager(prisma, tenantId);

    const managerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: manager.email, password: manager.password })
      .expect(200);

    await request(app.getHttpServer())
      .post('/ownership-plans')
      .set('Authorization', `Bearer ${managerLogin.body.accessToken}`)
      .send(planBody(driverId, motorcycleId))
      .expect(403);
  });

  describe('contract document (§9)', () => {
    async function createPlan(accessToken: string, tag: string) {
      const { driverId, driverEmail, motorcycleId } = await createDriverAndVehicle(
        accessToken,
        tag,
      );
      const planRes = await request(app.getHttpServer())
        .post('/ownership-plans')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(planBody(driverId, motorcycleId))
        .expect(201);
      return { planId: planRes.body.id as string, driverId, driverEmail, motorcycleId };
    }

    it('generates a contract as OWNER: 201, a Document row exists, and the file is on disk', async () => {
      const { accessToken, tenantId } = await signupOwner(app);
      const { planId } = await createPlan(accessToken, 'D1');

      const res = await request(app.getHttpServer())
        .post(`/ownership-plans/${planId}/contract`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);

      expect(res.body.ownerType).toBe('OWNERSHIP_PLAN');
      expect(res.body.docType).toBe('HIRE_PURCHASE_CONTRACT');
      expect(res.body.ownerId).toBe(planId);

      const document = await requestContext.runUnscoped(() =>
        prisma.client.document.findUnique({ where: { id: res.body.id } }),
      );
      expect(document).not.toBeNull();
      expect(document?.tenantId).toBe(tenantId);
      const absolutePath = `${process.env.UPLOADS_DIR ?? './uploads'}/${document?.storageKey}`;
      await expect(fs.access(absolutePath)).resolves.toBeUndefined();
    });

    it('fetches the contract as OWNER (200, application/pdf), as the driver on the plan (200), rejects a different driver in the same tenant (404, indistinguishable from unknown), and a user in another tenant (not found)', async () => {
      const { accessToken } = await signupOwner(app);
      const { planId, driverEmail } = await createPlan(accessToken, 'E1');
      const { driverEmail: otherDriverEmail } = await createDriverAndVehicle(accessToken, 'E2');

      await request(app.getHttpServer())
        .post(`/ownership-plans/${planId}/contract`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);

      const ownerRes = await request(app.getHttpServer())
        .get(`/ownership-plans/${planId}/contract`)
        .set('Authorization', `Bearer ${accessToken}`)
        .buffer(true)
        .parse(bufferParser)
        .expect(200);
      expect(ownerRes.headers['content-type']).toContain('application/pdf');
      expect((ownerRes.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');

      const driverLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: driverEmail, password: 'driverpass123' })
        .expect(200);
      await request(app.getHttpServer())
        .get(`/ownership-plans/${planId}/contract`)
        .set('Authorization', `Bearer ${driverLogin.body.accessToken}`)
        .expect(200);

      const otherDriverLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: otherDriverEmail, password: 'driverpass123' })
        .expect(200);
      await request(app.getHttpServer())
        .get(`/ownership-plans/${planId}/contract`)
        .set('Authorization', `Bearer ${otherDriverLogin.body.accessToken}`)
        .expect(404);

      const { accessToken: otherTenantToken } = await signupOwner(app, {
        email: 'owner2@other-fleet.test',
        companyName: 'Other Fleet',
        phone: '+254700000099',
      });
      await request(app.getHttpServer())
        .get(`/ownership-plans/${planId}/contract`)
        .set('Authorization', `Bearer ${otherTenantToken}`)
        .expect(404);
    });

    it('returns 404 for a plan with no contract yet', async () => {
      const { accessToken } = await signupOwner(app);
      const { planId } = await createPlan(accessToken, 'F1');

      await request(app.getHttpServer())
        .get(`/ownership-plans/${planId}/contract`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });

    it('an uploaded scan supersedes the generated PDF, and regenerating afterwards supersedes the scan - /contracts lists all three newest-first', async () => {
      const { accessToken } = await signupOwner(app);
      const { planId } = await createPlan(accessToken, 'G1');

      const firstGenerate = await request(app.getHttpServer())
        .post(`/ownership-plans/${planId}/contract`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);

      const uploaded = await request(app.getHttpServer())
        .post('/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .field('ownerType', 'OWNERSHIP_PLAN')
        .field('ownerId', planId)
        .field('docType', 'HIRE_PURCHASE_CONTRACT')
        .attach('file', TINY_PDF, {
          filename: 'signed-contract.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);

      const afterUpload = await request(app.getHttpServer())
        .get(`/ownership-plans/${planId}/contract`)
        .set('Authorization', `Bearer ${accessToken}`)
        .buffer(true)
        .parse(bufferParser)
        .expect(200);
      // The scan supersedes the generated PDF - byte-for-byte the uploaded file.
      expect((afterUpload.body as Buffer).equals(TINY_PDF)).toBe(true);

      const secondGenerate = await request(app.getHttpServer())
        .post(`/ownership-plans/${planId}/contract`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);

      const afterRegenerate = await request(app.getHttpServer())
        .get(`/ownership-plans/${planId}/contract`)
        .set('Authorization', `Bearer ${accessToken}`)
        .buffer(true)
        .parse(bufferParser)
        .expect(200);
      // The newer generated PDF supersedes the scan - no longer the tiny scan bytes.
      expect((afterRegenerate.body as Buffer).equals(TINY_PDF)).toBe(false);
      expect((afterRegenerate.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');

      const list = await request(app.getHttpServer())
        .get(`/ownership-plans/${planId}/contracts`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(list.body).toHaveLength(3);
      expect(list.body.map((d: { id: string }) => d.id)).toEqual([
        secondGenerate.body.id,
        uploaded.body.id,
        firstGenerate.body.id,
      ]);
    });
  });

  describe('day excusals (Stage G4)', () => {
    function daysAgoIso(n: number): string {
      return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }

    it('OWNER can create (immediately APPROVED), list, and decline/revoke an excusal', async () => {
      const { accessToken } = await signupOwner(app);
      const { driverId, motorcycleId } = await createDriverAndVehicle(accessToken, 'X1');
      const planRes = await request(app.getHttpServer())
        .post('/ownership-plans')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(planBody(driverId, motorcycleId))
        .expect(201);
      const planId = planRes.body.id as string;

      const createRes = await request(app.getHttpServer())
        .post(`/ownership-plans/${planId}/excusals`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ excusedDate: daysAgoIso(1), reason: 'Msiba wa jamaa - phoned supervisor' })
        .expect(201);

      expect(createRes.body.status).toBe('APPROVED');
      expect(createRes.body.decidedByUserId).toBeTruthy();
      expect(createRes.body.decidedAt).toBeTruthy();
      expect(createRes.body.requestedByUserId).toBeFalsy();

      const listRes = await request(app.getHttpServer())
        .get(`/ownership-plans/${planId}/excusals`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].id).toBe(createRes.body.id);
      // Stage G5 Part 2 - the dashboard needs a name, not just an id.
      expect(listRes.body[0].decidedByName).toBe('Ada Lovelace');
      expect(listRes.body[0].requestedByName).toBeNull();

      const declineRes = await request(app.getHttpServer())
        .patch(`/ownership-plans/${planId}/excusals/${createRes.body.id}/decline`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(declineRes.body.status).toBe('DECLINED');

      // Declining again is rejected, not silently accepted.
      await request(app.getHttpServer())
        .patch(`/ownership-plans/${planId}/excusals/${createRes.body.id}/decline`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);
    });

    // The DRIVER-role rejection is covered above, in "lets a DRIVER GET
    // their own plan..." (reusing that test's driver login rather than
    // spending another /auth/login call - see the comment there).

    it('Stage G5: a MANAGER can create and revoke an excusal, not just OWNER', async () => {
      const { accessToken, tenantId } = await signupOwner(app);
      const { driverId, motorcycleId } = await createDriverAndVehicle(accessToken, 'X5');
      const planRes = await request(app.getHttpServer())
        .post('/ownership-plans')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(planBody(driverId, motorcycleId))
        .expect(201);
      const planId = planRes.body.id as string;

      const manager = await seedManager(prisma, tenantId);
      const managerLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: manager.email, password: manager.password })
        .expect(200);
      const managerToken = managerLogin.body.accessToken as string;

      const createRes = await request(app.getHttpServer())
        .post(`/ownership-plans/${planId}/excusals`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ excusedDate: daysAgoIso(1), reason: 'Manager-approved: funeral' })
        .expect(201);
      expect(createRes.body.status).toBe('APPROVED');

      const declineRes = await request(app.getHttpServer())
        .patch(`/ownership-plans/${planId}/excusals/${createRes.body.id}/decline`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
      expect(declineRes.body.status).toBe('DECLINED');
    });

    it('Stage G5: an excusal for a future date, before any assignment row exists, is accepted', async () => {
      const { accessToken } = await signupOwner(app);
      const { driverId, motorcycleId } = await createDriverAndVehicle(accessToken, 'X6');
      const planRes = await request(app.getHttpServer())
        .post('/ownership-plans')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(planBody(driverId, motorcycleId))
        .expect(201);
      const planId = planRes.body.id as string;

      const inFiveDays = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const createRes = await request(app.getHttpServer())
        .post(`/ownership-plans/${planId}/excusals`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ excusedDate: inFiveDays, reason: 'Driver gave advance notice for a family event' })
        .expect(201);

      expect(createRes.body.status).toBe('APPROVED');
      expect(createRes.body.excusedDate.slice(0, 10)).toBe(inFiveDays);
    });

    it('cross-tenant create and list both return 404, not 403', async () => {
      const { accessToken } = await signupOwner(app);
      const { driverId, motorcycleId } = await createDriverAndVehicle(accessToken, 'X3');
      const planRes = await request(app.getHttpServer())
        .post('/ownership-plans')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(planBody(driverId, motorcycleId))
        .expect(201);

      const { accessToken: otherTenantToken } = await signupOwner(app, {
        email: 'owner2@other-fleet.test',
        companyName: 'Other Fleet',
        phone: '+254700000099',
      });

      await request(app.getHttpServer())
        .post(`/ownership-plans/${planRes.body.id}/excusals`)
        .set('Authorization', `Bearer ${otherTenantToken}`)
        .send({ excusedDate: daysAgoIso(1), reason: 'Cross-tenant probe' })
        .expect(404);

      await request(app.getHttpServer())
        .get(`/ownership-plans/${planRes.body.id}/excusals`)
        .set('Authorization', `Bearer ${otherTenantToken}`)
        .expect(404);
    });

    it('an APPROVED excusal moves consecutiveMissedDays but touches no money figure', async () => {
      const { accessToken } = await signupOwner(app);
      const { driverId, motorcycleId } = await createDriverAndVehicle(accessToken, 'X4');
      const planRes = await request(app.getHttpServer())
        .post('/ownership-plans')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(planBody(driverId, motorcycleId))
        .expect(201);
      const planId = planRes.body.id as string;

      // Two unpaid, elapsed assigned days, seeded directly (no need to run
      // the nightly generator for this) - an unexcused streak of 2.
      await prisma.client.dailyAssignment.create({
        data: {
          tenantId: planRes.body.tenantId,
          driverId,
          motorcycleId,
          ownershipPlanId: planId,
          assignedDate: new Date(daysAgoIso(2)),
          targetAmount: 12000,
        },
      });
      await prisma.client.dailyAssignment.create({
        data: {
          tenantId: planRes.body.tenantId,
          driverId,
          motorcycleId,
          ownershipPlanId: planId,
          assignedDate: new Date(daysAgoIso(1)),
          targetAmount: 12000,
        },
      });

      const before = await request(app.getHttpServer())
        .get(`/ownership-plans/${planId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(before.body.consecutiveMissedDays).toBe(2);

      await request(app.getHttpServer())
        .post(`/ownership-plans/${planId}/excusals`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ excusedDate: daysAgoIso(2), reason: 'Mgonjwa - alimjulisha msimamizi' })
        .expect(201);

      const after = await request(app.getHttpServer())
        .get(`/ownership-plans/${planId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // The excused day is transparent - only the other, unexcused day counts.
      expect(after.body.consecutiveMissedDays).toBe(1);

      // Every money figure, asserted individually, unchanged by the excusal.
      expect(after.body.amountDue).toBe(before.body.amountDue);
      expect(after.body.amountPaid).toBe(before.body.amountPaid);
      expect(after.body.amountBilled).toBe(before.body.amountBilled);
      expect(after.body.netPosition).toBe(before.body.netPosition);
      expect(after.body.daysBehind).toBe(before.body.daysBehind);
      expect(after.body.daysAhead).toBe(before.body.daysAhead);
      expect(after.body.remainingToOwn).toBe(before.body.remainingToOwn);
      expect(after.body.remainingToBill).toBe(before.body.remainingToBill);
    });
  });
});
