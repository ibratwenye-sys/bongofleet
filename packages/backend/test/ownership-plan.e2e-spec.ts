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
});
