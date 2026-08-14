import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/modules/auth/utils/password.util';
import { cleanDatabase } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';

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

let driverSeedCounter = 0;

async function seedDriverAssignment(
  prisma: PrismaService,
  tenantId: string,
  overrides: { driverEmail?: string; targetAmount?: number } = {},
) {
  driverSeedCounter += 1;
  const driverEmail = overrides.driverEmail ?? `driver${driverSeedCounter}@acme-fleet.test`;
  const password = 'password123';

  const user = await prisma.client.user.create({
    data: {
      tenantId,
      email: driverEmail,
      phone: `+25471${String(driverSeedCounter).padStart(7, '0')}`,
      passwordHash: await hashPassword(password),
      role: UserRole.RIDER,
      firstName: 'Dara',
      lastName: 'Ver',
    },
  });

  const driver = await prisma.client.driver.create({
    data: {
      tenantId,
      userId: user.id,
      licenseNumber: `LIC-${user.id}`,
    },
  });

  const motorcycle = await prisma.client.motorcycle.create({
    data: {
      tenantId,
      registrationNumber: `KDA-${user.id}`,
    },
  });

  const assignment = await prisma.client.dailyAssignment.create({
    data: {
      tenantId,
      driverId: driver.id,
      motorcycleId: motorcycle.id,
      assignedDate: new Date('2026-07-01'),
      targetAmount: overrides.targetAmount ?? 50000,
    },
  });

  return { driverEmail, password, driver, motorcycle, assignment };
}

describe('Payment (e2e)', () => {
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
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  it('records a payment and reconciles it to COMPLETED, stamping paidAt', async () => {
    const { accessToken: ownerToken, tenantId } = await signupOwner(app);
    const { driverEmail, password, driver, assignment } = await seedDriverAssignment(
      prisma,
      tenantId,
    );

    const driverLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: driverEmail, password })
      .expect(200);
    const driverToken = driverLogin.body.accessToken as string;

    const createRes = await request(app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ dailyAssignmentId: assignment.id, driverId: driver.id, amount: 40000 })
      .expect(201);

    expect(createRes.body.status).toBe('PENDING');
    expect(createRes.body.paidAt).toBeNull();

    const patchRes = await request(app.getHttpServer())
      .patch(`/payments/${createRes.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'COMPLETED' })
      .expect(200);

    expect(patchRes.body.status).toBe('COMPLETED');
    expect(patchRes.body.paidAt).not.toBeNull();
  });

  it("rejects a RIDER recording a payment for another driver's assignment", async () => {
    const { tenantId } = await signupOwner(app);
    const { assignment } = await seedDriverAssignment(prisma, tenantId, {
      driverEmail: 'owner-of-assignment@acme-fleet.test',
    });
    const { driverEmail, password } = await seedDriverAssignment(prisma, tenantId, {
      driverEmail: 'different-driver@acme-fleet.test',
    });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: driverEmail, password })
      .expect(200);

    await request(app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ dailyAssignmentId: assignment.id, driverId: assignment.driverId, amount: 1000 })
      .expect(403);
  });

  it('rejects an amount exceeding 150% of the target amount', async () => {
    const { accessToken, tenantId } = await signupOwner(app);
    const { driver, assignment } = await seedDriverAssignment(prisma, tenantId, {
      targetAmount: 50000,
    });

    await request(app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ dailyAssignmentId: assignment.id, driverId: driver.id, amount: 76000 })
      .expect(400);
  });

  it("enforces tenant isolation: a second tenant cannot see or fetch the first tenant's payments", async () => {
    const { accessToken: ownerAToken, tenantId: tenantAId } = await signupOwner(app);
    const { driver, assignment } = await seedDriverAssignment(prisma, tenantAId);

    const paymentRes = await request(app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ dailyAssignmentId: assignment.id, driverId: driver.id, amount: 30000 })
      .expect(201);

    const { accessToken: ownerBToken } = await signupOwner(app, {
      email: 'owner-b@other-fleet.test',
      companyName: 'Other Fleet',
      phone: '+254700000099',
    });

    const listRes = await request(app.getHttpServer())
      .get('/payments')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(200);
    expect(listRes.body).toHaveLength(0);

    await request(app.getHttpServer())
      .get(`/payments/${paymentRes.body.id}`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(404);
  });

  it('gets a clean 403 when a RIDER calls PATCH /payments/:id', async () => {
    const { accessToken: ownerToken, tenantId } = await signupOwner(app);
    const { driverEmail, password, driver, assignment } = await seedDriverAssignment(
      prisma,
      tenantId,
    );

    const createRes = await request(app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ dailyAssignmentId: assignment.id, driverId: driver.id, amount: 20000 })
      .expect(201);

    const driverLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: driverEmail, password })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/payments/${createRes.body.id}`)
      .set('Authorization', `Bearer ${driverLogin.body.accessToken}`)
      .send({ status: 'COMPLETED' })
      .expect(403);
  });

  describe('paymentAccountId (Stage F2 Part 2)', () => {
    it('persists a valid paymentAccountId on the created payment', async () => {
      const { accessToken, tenantId } = await signupOwner(app);
      const { driver, assignment } = await seedDriverAssignment(prisma, tenantId);

      const account = await request(app.getHttpServer())
        .post('/payment-accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ kind: 'MOBILE_MONEY', provider: 'M-Pesa', accountNumber: '+255700000001' })
        .expect(201);

      const paymentRes = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          dailyAssignmentId: assignment.id,
          driverId: driver.id,
          amount: 20000,
          paymentAccountId: account.body.id,
        })
        .expect(201);

      expect(paymentRes.body.paymentAccountId).toBe(account.body.id);
    });

    it('rejects a paymentAccountId belonging to another tenant with 400', async () => {
      const { accessToken: ownerAToken, tenantId: tenantAId } = await signupOwner(app);
      const { driver, assignment } = await seedDriverAssignment(prisma, tenantAId);

      const { accessToken: ownerBToken } = await signupOwner(app, {
        email: 'owner-b-accounts@other-fleet.test',
        companyName: 'Other Fleet Accounts',
        phone: '+254700000098',
      });
      const otherTenantAccount = await request(app.getHttpServer())
        .post('/payment-accounts')
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send({ kind: 'MOBILE_MONEY', provider: 'M-Pesa', accountNumber: '+255700000002' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          dailyAssignmentId: assignment.id,
          driverId: driver.id,
          amount: 20000,
          paymentAccountId: otherTenantAccount.body.id,
        })
        .expect(400);
    });

    it('still succeeds, unchanged, when paymentAccountId is omitted', async () => {
      const { accessToken, tenantId } = await signupOwner(app);
      const { driver, assignment } = await seedDriverAssignment(prisma, tenantId);

      const paymentRes = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ dailyAssignmentId: assignment.id, driverId: driver.id, amount: 20000 })
        .expect(201);

      expect(paymentRes.body.paymentAccountId).toBeNull();
    });
  });
});

describe('Payment module does not affect the auth rate limiter', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = await createTestApp(moduleFixture);
    prisma = moduleFixture.get(PrismaService);
    await cleanDatabase(prisma);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  it('still 429s on the 6th rapid /auth/login attempt', async () => {
    await signupOwner(app);

    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'owner@acme-fleet.test', password: 'wrong-password' })
        .expect(401);
    }

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'owner@acme-fleet.test', password: 'wrong-password' })
      .expect(429);
  });
});
