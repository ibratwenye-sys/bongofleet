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
});
