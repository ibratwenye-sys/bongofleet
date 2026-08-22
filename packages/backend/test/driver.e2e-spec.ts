import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanDatabase, CLEAN_DATABASE_HOOK_TIMEOUT_MS } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';
import { signupAndActivateOwner } from './utils/verified-signup.util';

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
  const { accessToken, tenantId } = await signupAndActivateOwner(app, body);
  return { accessToken, tenantId };
}

const driverBody = {
  firstName: 'Dara',
  lastName: 'Ver',
  phone: '+254711111111',
  email: 'newdriver@acme-fleet.test',
  licenseNumber: 'LIC-001',
  initialPassword: 'password123',
};

describe('Driver (e2e)', () => {
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

  it('creates a driver who can log in, lists them, then deactivates so login fails', async () => {
    const { accessToken } = await signupOwner(app);

    const createRes = await request(app.getHttpServer())
      .post('/drivers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(driverBody)
      .expect(201);

    expect(createRes.body.user).toBeDefined();
    expect(createRes.body.user.passwordHash).toBeUndefined();
    expect(createRes.body.passwordHash).toBeUndefined();

    // end-to-end proof the account actually works, not just that a row exists
    const driverLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: driverBody.email, password: driverBody.initialPassword })
      .expect(200);
    expect(driverLogin.body.accessToken).toBeDefined();

    const listRes = await request(app.getHttpServer())
      .get('/drivers')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].user.email).toBe(driverBody.email);

    await request(app.getHttpServer())
      .delete(`/drivers/${createRes.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: driverBody.email, password: driverBody.initialPassword })
      .expect(401);

    const listAfterDeactivate = await request(app.getHttpServer())
      .get('/drivers')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listAfterDeactivate.body).toHaveLength(0);

    const listIncludingInactive = await request(app.getHttpServer())
      .get('/drivers')
      .query({ includeInactive: 'true' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listIncludingInactive.body).toHaveLength(1);
    expect(listIncludingInactive.body[0].isActive).toBe(false);

    const reactivateRes = await request(app.getHttpServer())
      .patch(`/drivers/${createRes.body.id}/reactivate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(reactivateRes.body.isActive).toBe(true);

    // end-to-end proof reactivation actually restores login, not just a flag flip
    const loginAfterReactivate = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: driverBody.email, password: driverBody.initialPassword })
      .expect(200);
    expect(loginAfterReactivate.body.accessToken).toBeDefined();

    const listAfterReactivate = await request(app.getHttpServer())
      .get('/drivers')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listAfterReactivate.body).toHaveLength(1);
  });

  it("enforces tenant isolation on reactivate: a second tenant cannot reactivate the first tenant's driver", async () => {
    const { accessToken: ownerAToken } = await signupOwner(app);

    const createRes = await request(app.getHttpServer())
      .post('/drivers')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send(driverBody)
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/drivers/${createRes.body.id}`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .expect(204);

    const { accessToken: ownerBToken } = await signupOwner(app, {
      email: 'owner-b@other-fleet.test',
      companyName: 'Other Fleet',
      phone: '+254700000099',
    });

    await request(app.getHttpServer())
      .patch(`/drivers/${createRes.body.id}/reactivate`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(404);
  });

  it('rejects a duplicate email', async () => {
    const { accessToken } = await signupOwner(app);

    await request(app.getHttpServer())
      .post('/drivers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(driverBody)
      .expect(201);

    await request(app.getHttpServer())
      .post('/drivers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...driverBody, licenseNumber: 'LIC-002', phone: '+254722222222' })
      .expect(409);
  });

  it("enforces tenant isolation: a second tenant cannot see or fetch the first tenant's drivers", async () => {
    const { accessToken: ownerAToken } = await signupOwner(app);

    const createRes = await request(app.getHttpServer())
      .post('/drivers')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send(driverBody)
      .expect(201);

    const { accessToken: ownerBToken } = await signupOwner(app, {
      email: 'owner-b@other-fleet.test',
      companyName: 'Other Fleet',
      phone: '+254700000099',
    });

    const listRes = await request(app.getHttpServer())
      .get('/drivers')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(200);
    expect(listRes.body).toHaveLength(0);

    await request(app.getHttpServer())
      .get(`/drivers/${createRes.body.id}`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(404);
  });

  it('gets a clean 403 when a RIDER attempts to create a driver', async () => {
    const { accessToken } = await signupOwner(app);

    await request(app.getHttpServer())
      .post('/drivers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(driverBody)
      .expect(201);

    const driverLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: driverBody.email, password: driverBody.initialPassword })
      .expect(200);

    await request(app.getHttpServer())
      .post('/drivers')
      .set('Authorization', `Bearer ${driverLogin.body.accessToken}`)
      .send({ ...driverBody, licenseNumber: 'LIC-003', phone: '+254733333333', email: 'x@y.test' })
      .expect(403);
  });

  it('still serves the /riders alias for one release', async () => {
    const { accessToken } = await signupOwner(app);

    await request(app.getHttpServer())
      .post('/riders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(driverBody)
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get('/riders')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].user.email).toBe(driverBody.email);
  });
});
