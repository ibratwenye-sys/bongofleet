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

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function signupOwner(app: INestApplication, overrides: Partial<Record<string, string>> = {}) {
  const body = {
    email: 'owner@expense-summary.test',
    password: 'password123',
    companyName: 'Expense Summary Co',
    firstName: 'Ibrahim',
    lastName: 'Owner',
    phone: '+255700006001',
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

async function createVehicle(
  app: INestApplication,
  token: string,
  tag: string,
  vehicleType?: string,
) {
  const res = await request(app.getHttpServer())
    .post('/motorcycles')
    .set('Authorization', `Bearer ${token}`)
    .send({ registrationNumber: `REG-${tag}`, ...(vehicleType ? { vehicleType } : {}) })
    .expect(201);
  return res.body.id as string;
}

describe('Expenses summary (e2e, Stage UI3)', () => {
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
      'manager@expense-summary.test',
      '+255700006002',
    );
    const riderToken = await loginAs(
      prisma,
      app,
      tenantId,
      UserRole.RIDER,
      'rider@expense-summary.test',
      '+255700006003',
    );

    for (const token of [ownerToken, managerToken]) {
      await request(app.getHttpServer())
        .get('/expenses/summary')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }
    await request(app.getHttpServer())
      .get('/expenses/summary')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
    await request(app.getHttpServer()).get('/expenses/summary').expect(401);
  });

  it('computes spentThisMonth/fuelThisMonth/repairsThisMonth/costPerVehicle from real expenses recorded this month', async () => {
    const { accessToken: token } = await signupOwner(app);
    const motoId = await createVehicle(app, token, 'E1');

    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'Fuel', amount: 30000, incurredAt: isoDaysAgo(1), motorcycleId: motoId })
      .expect(201);
    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'Repairs', amount: 20000, incurredAt: isoDaysAgo(1), motorcycleId: motoId })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/expenses/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.kpis).toMatchObject({
      spentThisMonth: '50000.00',
      fuelThisMonth: '30000.00',
      repairsThisMonth: '20000.00',
      claimsAwaitingApproval: 0,
      costPerVehicle: '50000.00', // 50000 / 1 active vehicle
    });
  });

  it("cost-per-vehicle-type divides each type's expense total by that type's own active fleet count", async () => {
    const { accessToken: token } = await signupOwner(app);
    const truckId = await createVehicle(app, token, 'E2', 'TRUCK');

    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'Fuel', amount: 90000, incurredAt: isoDaysAgo(1), motorcycleId: truckId })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/expenses/cost-per-vehicle-type')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const truckRow = res.body.find((r: { vehicleType: string }) => r.vehicleType === 'TRUCK');
    expect(truckRow).toMatchObject({ costPerVehicle: '90000.00' }); // 90000 / 1 truck
    const bikeRow = res.body.find((r: { vehicleType: string }) => r.vehicleType === 'MOTORBIKE');
    expect(bikeRow).toMatchObject({ costPerVehicle: '0.00' }); // no motorbikes at all
  });

  it('anomalies endpoint is reachable and returns an array (formula precision covered by expense-summary.service.spec.ts)', async () => {
    const { accessToken: token } = await signupOwner(app);
    const res = await request(app.getHttpServer())
      .get('/expenses/anomalies')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('keeps each tenant to its own numbers', async () => {
    const ownerA = await signupOwner(app, {
      email: 'owner-a@expense-summary.test',
      companyName: 'Fleet EA',
      phone: '+255700006010',
    });
    const ownerB = await signupOwner(app, {
      email: 'owner-b@expense-summary.test',
      companyName: 'Fleet EB',
      phone: '+255700006011',
    });
    const motoId = await createVehicle(app, ownerB.accessToken, 'E3');
    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ category: 'Fuel', amount: 20000, incurredAt: isoDaysAgo(1), motorcycleId: motoId })
      .expect(201);

    const resA = await request(app.getHttpServer())
      .get('/expenses/summary')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .expect(200);
    expect(resA.body.kpis.spentThisMonth).toBe('0.00');
  });
});
