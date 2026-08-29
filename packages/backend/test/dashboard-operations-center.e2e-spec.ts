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
    email: 'owner@ops-center.test',
    password: 'password123',
    companyName: 'Ops Center Fleet',
    firstName: 'Ibrahim',
    lastName: 'Owner',
    phone: '+255700000901',
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

describe('GET /dashboard/operations-center (e2e, Stage UI1)', () => {
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

  it('OWNER and MANAGER both get 200 with the six KPI fields; RIDER and MECHANIC get 403', async () => {
    const { accessToken: ownerToken, tenantId } = await signupOwner(app);
    const managerToken = await loginAs(
      prisma,
      app,
      tenantId,
      UserRole.MANAGER,
      'manager@ops-center.test',
      '+255700000902',
    );
    const riderToken = await loginAs(
      prisma,
      app,
      tenantId,
      UserRole.RIDER,
      'rider@ops-center.test',
      '+255700000903',
    );
    const mechanicToken = await loginAs(
      prisma,
      app,
      tenantId,
      UserRole.MECHANIC,
      'mechanic@ops-center.test',
      '+255700000904',
    );

    for (const token of [ownerToken, managerToken]) {
      const res = await request(app.getHttpServer())
        .get('/dashboard/operations-center')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.kpis).toEqual(
        expect.objectContaining({
          onTheRoad: expect.objectContaining({ count: expect.any(Number), fleetSize: 0 }),
          collectedToday: expect.objectContaining({ amount: '0.00' }),
          outstandingToday: expect.objectContaining({ count: 0, amount: '0.00' }),
          activeOwnershipPlans: expect.objectContaining({ count: 0 }),
          serviceDue: expect.objectContaining({ count: 0 }),
          netProfitToday: expect.objectContaining({ amount: '0.00' }),
        }),
      );
      expect(res.body.worstPerformerToday).toBeNull();
      expect(Array.isArray(res.body.alerts)).toBe(true);
      expect(Array.isArray(res.body.collectionSeries)).toBe(true);
      expect(res.body.collectionSeries).toHaveLength(14);
    }

    for (const token of [riderToken, mechanicToken]) {
      await request(app.getHttpServer())
        .get('/dashboard/operations-center')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    }
  });

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/dashboard/operations-center').expect(401);
  });

  it('only ever counts this tenant’s own fleet, never leaking another tenant’s numbers', async () => {
    const ownerA = await signupOwner(app, {
      email: 'owner-a@ops-center.test',
      companyName: 'Fleet A',
      phone: '+255700000905',
    });
    const ownerB = await signupOwner(app, {
      email: 'owner-b@ops-center.test',
      companyName: 'Fleet B',
      phone: '+255700000906',
    });

    // Tenant B gets two vehicles; tenant A gets none.
    await request(app.getHttpServer())
      .post('/motorcycles')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ registrationNumber: 'T900 OPS', vehicleType: 'MOTORBIKE' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/motorcycles')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ registrationNumber: 'T901 OPS', vehicleType: 'MOTORBIKE' })
      .expect(201);

    const resA = await request(app.getHttpServer())
      .get('/dashboard/operations-center')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .expect(200);
    const resB = await request(app.getHttpServer())
      .get('/dashboard/operations-center')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(200);

    expect(resA.body.kpis.onTheRoad.fleetSize).toBe(0);
    expect(resB.body.kpis.onTheRoad.fleetSize).toBe(2);
  });
});
