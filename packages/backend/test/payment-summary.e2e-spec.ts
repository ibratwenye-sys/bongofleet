import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/modules/auth/utils/password.util';
import { cleanDatabase, CLEAN_DATABASE_HOOK_TIMEOUT_MS } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';
import { signupAndActivateOwner } from './utils/verified-signup.util';
import { dateOnlyInDarEsSalaam } from '../src/modules/ownership-plan/ownership-plan.derivation';

/** "Today" in the same Africa/Dar_es_Salaam terms getDailyCollectionStatus
 *  uses - plain UTC toISOString() would drift a day off near local
 *  midnight and make the day-level assertions below flaky. */
function isoToday(): string {
  return dateOnlyInDarEsSalaam(new Date()).toISOString().slice(0, 10);
}

async function signupOwner(app: INestApplication, overrides: Partial<Record<string, string>> = {}) {
  const body = {
    email: 'owner@payment-summary.test',
    password: 'password123',
    companyName: 'Payment Summary Co',
    firstName: 'Ibrahim',
    lastName: 'Owner',
    phone: '+255700004001',
    ...overrides,
  };
  return signupAndActivateOwner(app, body);
}

async function loginAs(
  prisma: PrismaService,
  app: INestApplication,
  tenantId: string,
  role: UserRole,
  email: string,
  phone: string,
): Promise<string> {
  const passwordHash = await hashPassword('password123');
  await prisma.client.user.create({
    data: { tenantId, email, phone, passwordHash, role, firstName: 'Test', lastName: role },
  });
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: 'password123' })
    .expect(200);
  return res.body.accessToken as string;
}

async function setupFleet(app: INestApplication, token: string, tag: string) {
  const driverRes = await request(app.getHttpServer())
    .post('/drivers')
    .set('Authorization', `Bearer ${token}`)
    .send({
      firstName: 'Juma',
      lastName: tag,
      phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
      email: `driver-${tag.toLowerCase()}@payment-summary.test`,
      licenseNumber: `LIC-${tag}`,
      initialPassword: 'driverpass123',
    })
    .expect(201);
  const motoRes = await request(app.getHttpServer())
    .post('/motorcycles')
    .set('Authorization', `Bearer ${token}`)
    .send({ registrationNumber: `REG-${tag}` })
    .expect(201);
  return { driverId: driverRes.body.id as string, motorcycleId: motoRes.body.id as string };
}

async function assign(
  app: INestApplication,
  token: string,
  driverId: string,
  motorcycleId: string,
  date: string,
  target: number,
) {
  const res = await request(app.getHttpServer())
    .post('/assignments')
    .set('Authorization', `Bearer ${token}`)
    .send({ driverId, motorcycleId, assignedDate: date, targetAmount: target })
    .expect(201);
  return res.body.id as string;
}

async function pay(
  app: INestApplication,
  token: string,
  dailyAssignmentId: string,
  driverId: string,
  amount: number,
  complete: boolean,
  paymentMethod?: string,
) {
  const res = await request(app.getHttpServer())
    .post('/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({ dailyAssignmentId, driverId, amount, paymentMethod })
    .expect(201);
  if (complete) {
    await request(app.getHttpServer())
      .patch(`/payments/${res.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'COMPLETED' })
      .expect(200);
  }
  return res.body.id as string;
}

describe('Payments summary (e2e, Stage UI3)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = await createTestApp(moduleFixture);
    prisma = moduleFixture.get(PrismaService);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  }, CLEAN_DATABASE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  }, CLEAN_DATABASE_HOOK_TIMEOUT_MS);

  it('OWNER and MANAGER get 200; RIDER is forbidden; unauthenticated is rejected', async () => {
    const { accessToken: ownerToken, tenantId } = await signupOwner(app);
    const managerToken = await loginAs(
      prisma,
      app,
      tenantId,
      UserRole.MANAGER,
      'manager@payment-summary.test',
      '+255700004002',
    );
    const riderToken = await loginAs(
      prisma,
      app,
      tenantId,
      UserRole.RIDER,
      'rider@payment-summary.test',
      '+255700004003',
    );

    for (const token of [ownerToken, managerToken]) {
      await request(app.getHttpServer())
        .get('/payments/summary')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }
    await request(app.getHttpServer())
      .get('/payments/summary')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
    await request(app.getHttpServer()).get('/payments/summary').expect(401);
  });

  // Note: dueToday/receivedToday/stillOutstanding are asserted precisely in
  // payment-summary.service.spec.ts (with an injected `now`), not here.
  // getDailyCollectionStatus's "today" comes from dateOnlyInDarEsSalaam,
  // which shifts by a fixed +3h and then re-truncates in UTC terms - so it
  // can read up to 3 hours "ahead" of the real UTC instant a same-e2e-test
  // paidAt/createdAt is stamped with, depending what time this suite
  // happens to run. dashboard-operations-center.e2e-spec.ts hits the exact
  // same limitation and works around it the same way: e2e only asserts a
  // zero baseline for "today", never a same-run non-zero value: a genuine,
  // narrow, pre-existing gap between date-only fields (assignedDate, which
  // stays internally consistent because it's built from that same shifted
  // "today") and instant fields (paidAt/createdAt, stamped from the real,
  // unshifted clock) - out of this stage's scope to fix (dateOnlyInDarEsSalaam
  // is shared by dashboard.service.ts, assignment-summary.service.ts, and
  // more). Month-level figures below don't hit this: assignedDate and the
  // month boundary are both built from the same shifted "today", so they
  // agree regardless of the real clock (barring the same few-hour window on
  // the calendar month's own last day, which this suite doesn't chase either).
  it('a fresh tenant sees an all-zero shape for every KPI', async () => {
    const { accessToken: token } = await signupOwner(app);
    const res = await request(app.getHttpServer())
      .get('/payments/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.kpis).toEqual({
      dueToday: '0.00',
      receivedToday: '0.00',
      stillOutstanding: { count: 0, amount: '0.00' },
      dueThisMonth: '0.00',
      receivedThisMonth: '0.00',
    });
  });

  it('computes dueThisMonth/receivedThisMonth from real assignments and payments dated today', async () => {
    const { accessToken: token } = await signupOwner(app);
    // A driver/vehicle can only have one assignment per day (schema
    // @@unique on both), so the two same-day assignments below need two
    // separate driver+vehicle pairs.
    const fleet1 = await setupFleet(app, token, 'P1A');
    const fleet2 = await setupFleet(app, token, 'P1B');
    const today = isoToday();

    // Two assignments today: one fully paid (12000), one short by 4000
    // (target 10000, paid 6000) - the shortfall doesn't affect
    // dueThisMonth/receivedThisMonth, which are asserted here.
    const a1 = await assign(app, token, fleet1.driverId, fleet1.motorcycleId, today, 12000);
    await pay(app, token, a1, fleet1.driverId, 12000, true);
    const a2 = await assign(app, token, fleet2.driverId, fleet2.motorcycleId, today, 10000);
    await pay(app, token, a2, fleet2.driverId, 6000, true);

    const res = await request(app.getHttpServer())
      .get('/payments/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.kpis).toMatchObject({
      dueThisMonth: '22000.00', // 12000 + 10000
      receivedThisMonth: '18000.00', // 12000 + 6000
    });
  });

  it('method-breakdown groups by method and separates PENDING amounts', async () => {
    const { accessToken: token } = await signupOwner(app);
    const fleet1 = await setupFleet(app, token, 'P2A');
    const fleet2 = await setupFleet(app, token, 'P2B');
    const today = isoToday();

    const a1 = await assign(app, token, fleet1.driverId, fleet1.motorcycleId, today, 12000);
    await pay(app, token, a1, fleet1.driverId, 12000, true, 'CASH');
    const a2 = await assign(app, token, fleet2.driverId, fleet2.motorcycleId, today, 10000);
    await pay(app, token, a2, fleet2.driverId, 5000, false, 'MOBILE_MONEY'); // left PENDING

    // No date filter (all-time) - a narrow single-day query would hit the
    // exact same dateOnlyInDarEsSalaam-vs-real-clock gap explained above.
    const res = await request(app.getHttpServer())
      .get('/payments/method-breakdown')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const cash = res.body.find((r: { method: string }) => r.method === 'CASH');
    const mobile = res.body.find((r: { method: string }) => r.method === 'MOBILE_MONEY');
    expect(cash).toMatchObject({ count: 1, amount: '12000.00', pendingCount: 0 });
    expect(mobile).toMatchObject({
      count: 1,
      amount: '5000.00',
      pendingCount: 1,
      pendingAmount: '5000.00',
    });
  });

  it('needs-reconciling returns PENDING payments oldest-first with real driver names', async () => {
    const { accessToken: token } = await signupOwner(app);
    const fleet1 = await setupFleet(app, token, 'P3A');
    const fleet2 = await setupFleet(app, token, 'P3B');
    const today = isoToday();

    const a1 = await assign(app, token, fleet1.driverId, fleet1.motorcycleId, today, 12000);
    const p1 = await pay(app, token, a1, fleet1.driverId, 12000, false);
    const a2 = await assign(app, token, fleet2.driverId, fleet2.motorcycleId, today, 10000);
    const p2 = await pay(app, token, a2, fleet2.driverId, 10000, false);

    const res = await request(app.getHttpServer())
      .get('/payments/needs-reconciling')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.map((r: { paymentId: string }) => r.paymentId)).toEqual([p1, p2]);
    expect(res.body[0].driverName).toContain('Juma');
  });

  it('keeps each tenant to its own numbers', async () => {
    const ownerA = await signupOwner(app, {
      email: 'owner-a@payment-summary.test',
      companyName: 'Fleet PA',
      phone: '+255700004010',
    });
    const ownerB = await signupOwner(app, {
      email: 'owner-b@payment-summary.test',
      companyName: 'Fleet PB',
      phone: '+255700004011',
    });
    const { driverId, motorcycleId } = await setupFleet(app, ownerB.accessToken, 'P4');
    const a1 = await assign(app, ownerB.accessToken, driverId, motorcycleId, isoToday(), 8000);
    await pay(app, ownerB.accessToken, a1, driverId, 8000, true);

    const resA = await request(app.getHttpServer())
      .get('/payments/summary')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .expect(200);
    expect(resA.body.kpis.dueToday).toBe('0.00');
  });
});
