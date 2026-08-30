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

async function signupOwner(app: INestApplication, overrides: Partial<Record<string, string>> = {}) {
  const body = {
    email: 'owner@ownership-summary.test',
    password: 'password123',
    companyName: 'Ownership Summary Co',
    firstName: 'Ibrahim',
    lastName: 'Owner',
    phone: '+255700005001',
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

async function createDriverAndVehicle(app: INestApplication, token: string, tag: string) {
  const driverRes = await request(app.getHttpServer())
    .post('/drivers')
    .set('Authorization', `Bearer ${token}`)
    .send({
      firstName: 'Juma',
      lastName: tag,
      phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
      email: `driver-${tag.toLowerCase()}@ownership-summary.test`,
      licenseNumber: `LIC-${tag}`,
      initialPassword: 'driverpass123',
    })
    .expect(201);
  const motoRes = await request(app.getHttpServer())
    .post('/motorcycles')
    .set('Authorization', `Bearer ${token}`)
    .send({ registrationNumber: `REG-${tag}` })
    .expect(201);
  return {
    driverId: driverRes.body.id as string,
    motorcycleId: motoRes.body.id as string,
  };
}

describe('GET /ownership-plans/summary (e2e, Stage UI3)', () => {
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
      'manager@ownership-summary.test',
      '+255700005002',
    );
    const riderToken = await loginAs(
      prisma,
      app,
      tenantId,
      UserRole.RIDER,
      'rider@ownership-summary.test',
      '+255700005003',
    );

    for (const token of [ownerToken, managerToken]) {
      const res = await request(app.getHttpServer())
        .get('/ownership-plans/summary')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.expectedCompletions).toHaveLength(18);
    }
    await request(app.getHttpServer())
      .get('/ownership-plans/summary')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
    await request(app.getHttpServer()).get('/ownership-plans/summary').expect(401);
  });

  it('an all-zero shape when there are no plans', async () => {
    const { accessToken } = await signupOwner(app);
    const res = await request(app.getHttpServer())
      .get('/ownership-plans/summary')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.kpis).toEqual({
      activePlanCount: 0,
      onScheduleCount: 0,
      slippingCount: 0,
      toTerminateCount: 0,
      finishingEarlyCount: 0,
      missedDaysTotal: 0,
      moneyAtRisk: '0.00',
    });
    expect(res.body.insights).toEqual([]);
    expect(res.body.missedDaysTable).toEqual([]);
  });

  it('a freshly created ACTIVE plan lands on-schedule and feeds contractValueTotals/twoBalances from real numbers', async () => {
    const { accessToken: token } = await signupOwner(app);
    const { driverId, motorcycleId } = await createDriverAndVehicle(app, token, 'W1');

    await request(app.getHttpServer())
      .post('/ownership-plans')
      .set('Authorization', `Bearer ${token}`)
      .send({
        driverId,
        motorcycleId,
        dailyAmount: 12000,
        instalmentCount: 150, // totalOwed = 1,800,000
        totalPrice: 1_800_000,
        startDate: '2026-03-03',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/ownership-plans/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.kpis).toMatchObject({
      activePlanCount: 1,
      onScheduleCount: 1,
      toTerminateCount: 0,
      slippingCount: 0,
      moneyAtRisk: '0.00', // not flagged, so nothing is at risk
    });
    expect(res.body.contractValueTotals.totalOwed).toBe('1800000.00');
    expect(res.body.twoBalances.remainingToOwn).toBe('1800000.00'); // nothing paid yet
  });

  it('keeps each tenant to its own numbers', async () => {
    const ownerA = await signupOwner(app, {
      email: 'owner-a@ownership-summary.test',
      companyName: 'Fleet OA',
      phone: '+255700005010',
    });
    const ownerB = await signupOwner(app, {
      email: 'owner-b@ownership-summary.test',
      companyName: 'Fleet OB',
      phone: '+255700005011',
    });
    const { driverId, motorcycleId } = await createDriverAndVehicle(app, ownerB.accessToken, 'W2');
    await request(app.getHttpServer())
      .post('/ownership-plans')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({
        driverId,
        motorcycleId,
        dailyAmount: 10000,
        instalmentCount: 100,
        totalPrice: 1_000_000,
        startDate: '2026-03-03',
      })
      .expect(201);

    const resA = await request(app.getHttpServer())
      .get('/ownership-plans/summary')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .expect(200);
    expect(resA.body.kpis.activePlanCount).toBe(0);
  });
});
