import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanDatabase, CLEAN_DATABASE_HOOK_TIMEOUT_MS } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';

/**
 * Split out from ownership-plan.e2e-spec.ts (Stage G) rather than added to
 * it: that file already runs enough requests per test run to sit close to
 * the global throttle (100 req/60s, see app.module.ts) against one shared
 * in-memory bucket per app instance. A fresh app instance here - the normal
 * beforeAll for every e2e file - gets its own fresh bucket.
 */
async function signupOwner(app: INestApplication, overrides: Partial<Record<string, string>> = {}) {
  const body = {
    email: 'owner@guarantor-ledger.test',
    password: 'password123',
    companyName: 'Guarantor Ledger Fleet',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '+254700000301',
    ...overrides,
  };
  const res = await request(app.getHttpServer()).post('/auth/signup').send(body).expect(201);
  return { accessToken: res.body.accessToken as string };
}

describe('OwnershipPlan guarantorId + ledger (e2e, Stage G Part 3/3b)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seedCounter = 0;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = await createTestApp(moduleFixture);
    prisma = moduleFixture.get(PrismaService);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    seedCounter = 0;
  }, CLEAN_DATABASE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  }, CLEAN_DATABASE_HOOK_TIMEOUT_MS);

  async function createDriverAndVehicle(accessToken: string, tag: string) {
    seedCounter += 1;
    const email = `driver-${tag.toLowerCase()}-${seedCounter}@test.local`;
    const driverRes = await request(app.getHttpServer())
      .post('/drivers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Juma',
        lastName: tag,
        phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
        email,
        licenseNumber: `LIC-${tag}-${seedCounter}`,
        initialPassword: 'driverpass123',
      })
      .expect(201);
    const motoRes = await request(app.getHttpServer())
      .post('/motorcycles')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ registrationNumber: `REG-${tag}-${seedCounter}` })
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
    instalmentCount: 150, // totalOwed = 12,000 x 150 = 1,800,000
    totalPrice: 1_800_000,
    startDate: '2026-03-03',
  });

  describe('guarantorId', () => {
    it('accepts a guarantor belonging to the plan driver', async () => {
      const { accessToken } = await signupOwner(app);
      const { driverId, motorcycleId } = await createDriverAndVehicle(accessToken, 'G1');
      const guarantorRes = await request(app.getHttpServer())
        .post(`/drivers/${driverId}/guarantors`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ firstName: 'Zainabu', lastName: 'Hassan', phone: '+254700000201' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/ownership-plans')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...planBody(driverId, motorcycleId), guarantorId: guarantorRes.body.id })
        .expect(201);

      expect(res.body.guarantorId).toBe(guarantorRes.body.id);
    });

    it('returns 404, never 403, for a guarantor belonging to a different driver in the same tenant', async () => {
      const { accessToken } = await signupOwner(app);
      const { driverId, motorcycleId } = await createDriverAndVehicle(accessToken, 'G2');
      const { driverId: otherDriverId } = await createDriverAndVehicle(accessToken, 'G3');
      const guarantorRes = await request(app.getHttpServer())
        .post(`/drivers/${otherDriverId}/guarantors`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ firstName: 'Wrong', lastName: 'Driver', phone: '+254700000202' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/ownership-plans')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...planBody(driverId, motorcycleId), guarantorId: guarantorRes.body.id })
        .expect(404);
    });

    it('returns 404, never 403, for a guarantor belonging to a different tenant', async () => {
      const { accessToken } = await signupOwner(app);
      const { driverId, motorcycleId } = await createDriverAndVehicle(accessToken, 'G4');

      const otherTenant = await signupOwner(app, {
        email: 'owner2@other-fleet.test',
        companyName: 'Other Fleet',
      });
      const { driverId: otherTenantDriverId } = await createDriverAndVehicle(
        otherTenant.accessToken,
        'G5',
      );
      const guarantorRes = await request(app.getHttpServer())
        .post(`/drivers/${otherTenantDriverId}/guarantors`)
        .set('Authorization', `Bearer ${otherTenant.accessToken}`)
        .send({ firstName: 'Other', lastName: 'Tenant', phone: '+254700000203' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/ownership-plans')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...planBody(driverId, motorcycleId), guarantorId: guarantorRes.body.id })
        .expect(404);
    });
  });

  describe('ledger', () => {
    it('reflects the assignments the nightly generator actually creates, with a correct running position', async () => {
      const { accessToken } = await signupOwner(app);
      const { driverId, motorcycleId } = await createDriverAndVehicle(accessToken, 'L1');
      const planRes = await request(app.getHttpServer())
        .post('/ownership-plans')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(planBody(driverId, motorcycleId))
        .expect(201);

      await request(app.getHttpServer())
        .post('/ownership-plans/generate')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);

      const ledgerRes = await request(app.getHttpServer())
        .get(`/ownership-plans/${planRes.body.id}/ledger`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(ledgerRes.body)).toBe(true);
      expect(ledgerRes.body.length).toBeGreaterThan(0);
      for (const row of ledgerRes.body) {
        expect(row).toEqual(
          expect.objectContaining({
            assignedDate: expect.any(String),
            owed: '12000.00',
            paid: '0.00',
            runningPosition: expect.any(String),
          }),
        );
      }
      // Nothing paid yet, so every day's running position is <= 0 and strictly
      // decreasing (falling further behind by exactly one day's owed amount).
      const positions = ledgerRes.body.map((r: { runningPosition: string }) =>
        Number(r.runningPosition),
      );
      expect(positions[0]).toBe(-12000);
      expect(
        positions.every((p: number, i: number) => i === 0 || p === positions[i - 1] - 12000),
      ).toBe(true);
    });

    it("rejects a different driver's attempt to read someone else's ledger with 404", async () => {
      const { accessToken } = await signupOwner(app);
      const { driverId, motorcycleId } = await createDriverAndVehicle(accessToken, 'L2');
      const { driverEmail: otherEmail } = await createDriverAndVehicle(accessToken, 'L3');
      const planRes = await request(app.getHttpServer())
        .post('/ownership-plans')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(planBody(driverId, motorcycleId))
        .expect(201);

      const otherLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: otherEmail, password: 'driverpass123' })
        .expect(200);

      await request(app.getHttpServer())
        .get(`/ownership-plans/${planRes.body.id}/ledger`)
        .set('Authorization', `Bearer ${otherLogin.body.accessToken}`)
        .expect(404);
    });
  });
});
