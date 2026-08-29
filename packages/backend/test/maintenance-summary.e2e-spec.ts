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
    email: 'owner@maintenance-summary.test',
    password: 'password123',
    companyName: 'Maintenance Summary Co',
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

describe('GET /maintenance/summary (e2e, Stage UI2)', () => {
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

  it('OWNER and MANAGER get 200; RIDER and MECHANIC get 403 (same gate as GET /maintenance today - no MECHANIC access)', async () => {
    const { accessToken: ownerToken, tenantId } = await signupOwner(app);
    const managerToken = await loginAs(
      prisma,
      app,
      tenantId,
      UserRole.MANAGER,
      'manager@maintenance-summary.test',
      '+255700005002',
    );
    const riderToken = await loginAs(
      prisma,
      app,
      tenantId,
      UserRole.RIDER,
      'rider@maintenance-summary.test',
      '+255700005003',
    );
    const mechanicToken = await loginAs(
      prisma,
      app,
      tenantId,
      UserRole.MECHANIC,
      'mechanic@maintenance-summary.test',
      '+255700005004',
    );

    for (const token of [ownerToken, managerToken]) {
      const res = await request(app.getHttpServer())
        .get('/maintenance/summary')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.kpis).toEqual(
        expect.objectContaining({
          overdue: { count: 0 },
          dueWithin7Days: { count: 0 },
          dueWithin30Days: { count: 0 },
          nothingDue: { count: 0, percentOfFleet: 0 },
        }),
      );
      expect(Array.isArray(res.body.needsBooking)).toBe(true);
    }

    for (const token of [riderToken, mechanicToken]) {
      await request(app.getHttpServer())
        .get('/maintenance/summary')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    }
  });

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/maintenance/summary').expect(401);
  });

  it('only ever counts this tenant’s own fleet, never leaking another tenant’s numbers', async () => {
    const ownerA = await signupOwner(app, {
      email: 'owner-a@maintenance-summary.test',
      companyName: 'Fleet A',
      phone: '+255700005005',
    });
    const ownerB = await signupOwner(app, {
      email: 'owner-b@maintenance-summary.test',
      companyName: 'Fleet B',
      phone: '+255700005006',
    });

    await request(app.getHttpServer())
      .post('/motorcycles')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ registrationNumber: 'T900 MNT', vehicleType: 'MOTORBIKE' })
      .expect(201);

    const resA = await request(app.getHttpServer())
      .get('/maintenance/summary')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .expect(200);
    const resB = await request(app.getHttpServer())
      .get('/maintenance/summary')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(200);

    expect(resA.body.kpis.nothingDue.count).toBe(0);
    expect(resB.body.kpis.nothingDue.count).toBe(1);
  });
});
