import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestContext } from '../src/common/context/request-context';
import { hashPassword } from '../src/modules/auth/utils/password.util';
import { cleanDatabase, CLEAN_DATABASE_HOOK_TIMEOUT_MS } from './utils/prisma-test.util';
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

let seedCounter = 0;

async function seedDriverAssignment(prisma: PrismaService, tenantId: string) {
  seedCounter += 1;
  const driverEmail = `driver${seedCounter}@acme-fleet.test`;
  const password = 'password123';

  const user = await prisma.client.user.create({
    data: {
      tenantId,
      email: driverEmail,
      phone: `+25471${String(seedCounter).padStart(7, '0')}`,
      passwordHash: await hashPassword(password),
      role: UserRole.RIDER,
      firstName: 'Dara',
      lastName: 'Ver',
    },
  });
  const driver = await prisma.client.driver.create({
    data: { tenantId, userId: user.id, licenseNumber: `LIC-${user.id}` },
  });
  const motorcycle = await prisma.client.motorcycle.create({
    data: { tenantId, registrationNumber: `KDA-${user.id}` },
  });
  const assignment = await prisma.client.dailyAssignment.create({
    data: {
      tenantId,
      driverId: driver.id,
      motorcycleId: motorcycle.id,
      assignedDate: new Date('2026-07-01'),
      targetAmount: 50000,
    },
  });

  return { driverEmail, password, driver, motorcycle, assignment };
}

describe('PaymentAccount (e2e)', () => {
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
    seedCounter = 0;
  }, CLEAN_DATABASE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  }, CLEAN_DATABASE_HOOK_TIMEOUT_MS);

  it('supports the full CRUD lifecycle as OWNER', async () => {
    const { accessToken } = await signupOwner(app);

    const createRes = await request(app.getHttpServer())
      .post('/payment-accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        kind: 'BANK',
        provider: 'NMB',
        accountNumber: '0000000000',
        accountName: 'Acme Fleet Ltd',
      })
      .expect(201);
    expect(createRes.body.kind).toBe('BANK');
    expect(createRes.body.isActive).toBe(true);

    const listRes = await request(app.getHttpServer())
      .get('/payment-accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].id).toBe(createRes.body.id);

    const patchRes = await request(app.getHttpServer())
      .patch(`/payment-accounts/${createRes.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sortOrder: 5, isActive: false })
      .expect(200);
    expect(patchRes.body.sortOrder).toBe(5);
    expect(patchRes.body.isActive).toBe(false);

    await request(app.getHttpServer())
      .delete(`/payment-accounts/${createRes.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const afterDelete = await requestContext.runUnscoped(() =>
      prisma.client.paymentAccount.findUnique({ where: { id: createRes.body.id } }),
    );
    expect(afterDelete).toBeNull();
  });

  it('rejects an invalid BANK payload (missing accountName) with 400', async () => {
    const { accessToken } = await signupOwner(app);

    await request(app.getHttpServer())
      .post('/payment-accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ kind: 'BANK', provider: 'NMB', accountNumber: '0000000000' })
      .expect(400);
  });

  it('accepts a LIPA_NUMBER and a MOBILE_MONEY account without accountName', async () => {
    const { accessToken } = await signupOwner(app);

    await request(app.getHttpServer())
      .post('/payment-accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ kind: 'LIPA_NUMBER', provider: 'Azam Pesa', accountNumber: '000000' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/payment-accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ kind: 'MOBILE_MONEY', provider: 'M-Pesa', accountNumber: '+255700000001' })
      .expect(201);
  });

  it('rejects a RIDER on all four routes (403)', async () => {
    const { accessToken, tenantId } = await signupOwner(app);
    const { driverEmail, password } = await seedDriverAssignment(prisma, tenantId);
    const driverLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: driverEmail, password })
      .expect(200);
    const driverToken = driverLogin.body.accessToken as string;

    const created = await request(app.getHttpServer())
      .post('/payment-accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ kind: 'MOBILE_MONEY', provider: 'M-Pesa', accountNumber: '+255700000001' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/payment-accounts')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ kind: 'MOBILE_MONEY', provider: 'M-Pesa', accountNumber: '+255700000001' })
      .expect(403);

    await request(app.getHttpServer())
      .get('/payment-accounts')
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/payment-accounts/${created.body.id}`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ sortOrder: 1 })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/payment-accounts/${created.body.id}`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(403);
  });

  it('soft-deletes (isActive=false) an account referenced by a payment, and hard-deletes one with none', async () => {
    const { accessToken, tenantId } = await signupOwner(app);
    const { driverEmail, password, driver, assignment } = await seedDriverAssignment(
      prisma,
      tenantId,
    );

    const referenced = await request(app.getHttpServer())
      .post('/payment-accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ kind: 'MOBILE_MONEY', provider: 'M-Pesa', accountNumber: '+255700000001' })
      .expect(201);
    const unreferenced = await request(app.getHttpServer())
      .post('/payment-accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ kind: 'MOBILE_MONEY', provider: 'Airtel Money', accountNumber: '+255700000002' })
      .expect(201);

    const driverLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: driverEmail, password })
      .expect(200);

    await request(app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${driverLogin.body.accessToken}`)
      .send({
        dailyAssignmentId: assignment.id,
        driverId: driver.id,
        amount: 40000,
        paymentAccountId: referenced.body.id,
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/payment-accounts/${referenced.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/payment-accounts/${unreferenced.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const [referencedAfter, unreferencedAfter] = await requestContext.runUnscoped(() =>
      Promise.all([
        prisma.client.paymentAccount.findUnique({ where: { id: referenced.body.id } }),
        prisma.client.paymentAccount.findUnique({ where: { id: unreferenced.body.id } }),
      ]),
    );
    expect(referencedAfter).not.toBeNull();
    expect(referencedAfter?.isActive).toBe(false);
    expect(unreferencedAfter).toBeNull();
  });
});
