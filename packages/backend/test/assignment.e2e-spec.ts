import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
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

let driverSeedCounter = 0;

async function seedDriverAndMotorcycle(
  prisma: PrismaService,
  tenantId: string,
  overrides: { driverEmail?: string } = {},
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
    data: { tenantId, userId: user.id, licenseNumber: `LIC-${user.id}` },
  });

  const motorcycle = await prisma.client.motorcycle.create({
    data: { tenantId, registrationNumber: `KDA-${user.id}` },
  });

  return { driverEmail, password, driver, motorcycle };
}

describe('Assignment (e2e)', () => {
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

  it('creates an assignment, refuses delete once a payment exists', async () => {
    const { accessToken, tenantId } = await signupOwner(app);
    const { driver, motorcycle } = await seedDriverAndMotorcycle(prisma, tenantId);

    const createRes = await request(app.getHttpServer())
      .post('/assignments')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        motorcycleId: motorcycle.id,
        driverId: driver.id,
        assignedDate: '2026-07-01',
        targetAmount: 50000,
      })
      .expect(201);

    expect(createRes.body.id).toBeDefined();

    await request(app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ dailyAssignmentId: createRes.body.id, driverId: driver.id, amount: 20000 })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/assignments/${createRes.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('rejects double-booking the same motorcycle on the same date', async () => {
    const { accessToken, tenantId } = await signupOwner(app);
    const { driver, motorcycle } = await seedDriverAndMotorcycle(prisma, tenantId);
    const { driver: otherDriver } = await seedDriverAndMotorcycle(prisma, tenantId);

    await request(app.getHttpServer())
      .post('/assignments')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        motorcycleId: motorcycle.id,
        driverId: driver.id,
        assignedDate: '2026-07-01',
        targetAmount: 50000,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/assignments')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        motorcycleId: motorcycle.id,
        driverId: otherDriver.id,
        assignedDate: '2026-07-01',
        targetAmount: 50000,
      })
      .expect(409);
  });

  it("enforces tenant isolation: a second tenant cannot see or fetch the first tenant's assignments", async () => {
    const { accessToken: ownerAToken, tenantId: tenantAId } = await signupOwner(app);
    const { driver, motorcycle } = await seedDriverAndMotorcycle(prisma, tenantAId);

    const createRes = await request(app.getHttpServer())
      .post('/assignments')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        motorcycleId: motorcycle.id,
        driverId: driver.id,
        assignedDate: '2026-07-01',
        targetAmount: 50000,
      })
      .expect(201);

    const { accessToken: ownerBToken } = await signupOwner(app, {
      email: 'owner-b@other-fleet.test',
      companyName: 'Other Fleet',
      phone: '+254700000099',
    });

    const listRes = await request(app.getHttpServer())
      .get('/assignments')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(200);
    expect(listRes.body).toHaveLength(0);

    await request(app.getHttpServer())
      .get(`/assignments/${createRes.body.id}`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(404);
  });

  it("a RIDER's GET /assignments only returns their own", async () => {
    const { accessToken, tenantId } = await signupOwner(app);
    const {
      driver: driverA,
      motorcycle: motorcycleA,
      driverEmail,
      password,
    } = await seedDriverAndMotorcycle(prisma, tenantId);
    const { driver: driverB, motorcycle: motorcycleB } = await seedDriverAndMotorcycle(
      prisma,
      tenantId,
    );

    await request(app.getHttpServer())
      .post('/assignments')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        motorcycleId: motorcycleA.id,
        driverId: driverA.id,
        assignedDate: '2026-07-01',
        targetAmount: 50000,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/assignments')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        motorcycleId: motorcycleB.id,
        driverId: driverB.id,
        assignedDate: '2026-07-01',
        targetAmount: 50000,
      })
      .expect(201);

    const driverLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: driverEmail, password })
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get('/assignments')
      .set('Authorization', `Bearer ${driverLogin.body.accessToken}`)
      .expect(200);

    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].driverId).toBe(driverA.id);
  });

  it('gets a clean 403 when a RIDER attempts to create an assignment', async () => {
    const { tenantId } = await signupOwner(app);
    const { driverEmail, password } = await seedDriverAndMotorcycle(prisma, tenantId);

    const driverLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: driverEmail, password })
      .expect(200);

    await request(app.getHttpServer())
      .post('/assignments')
      .set('Authorization', `Bearer ${driverLogin.body.accessToken}`)
      .send({
        motorcycleId: 'irrelevant',
        driverId: 'irrelevant',
        assignedDate: '2026-07-01',
        targetAmount: 50000,
      })
      .expect(403);
  });
});
