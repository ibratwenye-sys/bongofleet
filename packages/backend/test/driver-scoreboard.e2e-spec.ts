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
    email: 'owner@driver-scoreboard.test',
    password: 'password123',
    companyName: 'Scoreboard Co',
    firstName: 'Ibrahim',
    lastName: 'Owner',
    phone: '+255700002001',
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

describe('GET /drivers/scoreboard (e2e, Stage UI2)', () => {
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

  it('OWNER and MANAGER get 200; RIDER and MECHANIC get 403', async () => {
    const { accessToken: ownerToken, tenantId } = await signupOwner(app);
    const managerToken = await loginAs(
      prisma,
      app,
      tenantId,
      UserRole.MANAGER,
      'manager@driver-scoreboard.test',
      '+255700002002',
    );
    const riderToken = await loginAs(
      prisma,
      app,
      tenantId,
      UserRole.RIDER,
      'rider@driver-scoreboard.test',
      '+255700002003',
    );
    const mechanicToken = await loginAs(
      prisma,
      app,
      tenantId,
      UserRole.MECHANIC,
      'mechanic@driver-scoreboard.test',
      '+255700002004',
    );

    for (const token of [ownerToken, managerToken]) {
      const res = await request(app.getHttpServer())
        .get('/drivers/scoreboard')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.kpis).toEqual(
        expect.objectContaining({
          totalDrivers: 0,
          excellent: 0,
          good: 0,
          watch: 0,
          atRisk: 0,
        }),
      );
      expect(Array.isArray(res.body.drivers)).toBe(true);
      expect(res.body.lowestScoring).toBeNull();
    }

    for (const token of [riderToken, mechanicToken]) {
      await request(app.getHttpServer())
        .get('/drivers/scoreboard')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    }
  });

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/drivers/scoreboard').expect(401);
  });

  it('only ever counts this tenant’s own drivers, never leaking another tenant’s numbers', async () => {
    const ownerA = await signupOwner(app, {
      email: 'owner-a@driver-scoreboard.test',
      companyName: 'Fleet A',
      phone: '+255700002005',
    });
    const ownerB = await signupOwner(app, {
      email: 'owner-b@driver-scoreboard.test',
      companyName: 'Fleet B',
      phone: '+255700002006',
    });

    await request(app.getHttpServer())
      .post('/drivers')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({
        firstName: 'Asha',
        lastName: 'Mbwana',
        phone: '+255700009001',
        email: 'asha@driver-scoreboard.test',
        licenseNumber: 'LIC-9001',
        initialPassword: 'password123',
      })
      .expect(201);

    const resA = await request(app.getHttpServer())
      .get('/drivers/scoreboard')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .expect(200);
    const resB = await request(app.getHttpServer())
      .get('/drivers/scoreboard')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(200);

    expect(resA.body.kpis.totalDrivers).toBe(0);
    expect(resB.body.kpis.totalDrivers).toBe(1);
  });
});
