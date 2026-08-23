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

let seedCounter = 0;

/** A CAR_DRIVER + a compatible CAR vehicle - transport jobs are the
 *  car/truck-driver-mode resource this stage covers, so the fixtures use a
 *  compatible pairing rather than the rider/motorbike default elsewhere in
 *  this test suite. */
async function seedCarDriverAndVehicle(app: INestApplication, accessToken: string, tag: string) {
  seedCounter += 1;
  const email = `driver-${tag.toLowerCase()}-${seedCounter}@test.local`;
  const driverRes = await request(app.getHttpServer())
    .post('/drivers')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      firstName: 'Juma',
      lastName: tag,
      phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
      email,
      licenseNumber: `LIC-${tag}-${seedCounter}`,
      initialPassword: 'driverpass123',
      driverType: 'CAR_DRIVER',
    })
    .expect(201);
  const motoRes = await request(app.getHttpServer())
    .post('/motorcycles')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ registrationNumber: `REG-${tag}-${seedCounter}`, vehicleType: 'CAR' })
    .expect(201);
  return {
    driverId: driverRes.body.id as string,
    driverEmail: email,
    motorcycleId: motoRes.body.id as string,
  };
}

async function createJob(
  app: INestApplication,
  accessToken: string,
  motorcycleId: string,
  driverId: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  const res = await request(app.getHttpServer())
    .post('/transport-jobs')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      motorcycleId,
      driverId,
      origin: 'Dar es Salaam',
      destination: 'Morogoro',
      revenue: 250000,
      scheduledDate: '2026-07-01',
      ...overrides,
    })
    .expect(201);
  return res.body.id as string;
}

describe('Transport job (e2e)', () => {
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

  // Stage DM4 - the list counterpart of the DM2 payments-list test: a list
  // can't 404, so the only thing to prove is that it's narrowed, not that a
  // wrong id is refused.
  it("a RIDER's GET /transport-jobs only returns their own, never another driver's in the same tenant", async () => {
    const { accessToken } = await signupOwner(app);
    const a = await seedCarDriverAndVehicle(app, accessToken, 'A1');
    const b = await seedCarDriverAndVehicle(app, accessToken, 'B1');

    await createJob(app, accessToken, a.motorcycleId, a.driverId, { origin: 'Job A' });
    await createJob(app, accessToken, b.motorcycleId, b.driverId, { origin: 'Job B' });

    const driverLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: a.driverEmail, password: 'driverpass123' })
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get('/transport-jobs')
      .set('Authorization', `Bearer ${driverLogin.body.accessToken}`)
      .expect(200);

    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].driverId).toBe(a.driverId);
    expect(listRes.body[0].origin).toBe('Job A');
  });

  it("a RIDER's GET /transport-jobs/:id 404s on another driver's job, same tenant", async () => {
    const { accessToken } = await signupOwner(app);
    const a = await seedCarDriverAndVehicle(app, accessToken, 'C1');
    const b = await seedCarDriverAndVehicle(app, accessToken, 'D1');

    const ownJobId = await createJob(app, accessToken, a.motorcycleId, a.driverId);
    const otherJobId = await createJob(app, accessToken, b.motorcycleId, b.driverId);

    const driverLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: a.driverEmail, password: 'driverpass123' })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/transport-jobs/${ownJobId}`)
      .set('Authorization', `Bearer ${driverLogin.body.accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/transport-jobs/${otherJobId}`)
      .set('Authorization', `Bearer ${driverLogin.body.accessToken}`)
      .expect(404);
  });

  // Stage DM4 - the field-level check the task asked for specifically:
  // revenue is the owner's earnings, not the driver's business, and
  // netProfit (= revenue - expensesTotal) is the same secret in a
  // different shape - excluding revenue alone would still leak it back out
  // via netProfit since expensesTotal stays visible. Asserted on the raw
  // response body's own keys, not on what the mobile client happens to
  // render - a UI that simply doesn't display a field the server still
  // sends proves nothing about the server.
  it("never includes revenue or netProfit in a RIDER's response body, on the list or the detail route", async () => {
    const { accessToken } = await signupOwner(app);
    const a = await seedCarDriverAndVehicle(app, accessToken, 'E1');
    const jobId = await createJob(app, accessToken, a.motorcycleId, a.driverId, {
      revenue: 999999,
    });

    // Sanity check first: the OWNER's own view of the same job DOES carry
    // both fields - proves the assertions below are testing an actual
    // exclusion, not a field that was never present in the first place.
    const ownerView = await request(app.getHttpServer())
      .get(`/transport-jobs/${jobId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(ownerView.body).toHaveProperty('revenue');
    expect(ownerView.body).toHaveProperty('netProfit');

    const driverLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: a.driverEmail, password: 'driverpass123' })
      .expect(200);
    const driverToken = driverLogin.body.accessToken as string;

    const listRes = await request(app.getHttpServer())
      .get('/transport-jobs')
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0]).not.toHaveProperty('revenue');
    expect(listRes.body[0]).not.toHaveProperty('netProfit');
    // Not stripped - the job's operational cost record, not the owner's
    // earnings (see transport.service.ts's omitOwnerFinancials comment).
    expect(listRes.body[0]).toHaveProperty('expensesTotal');

    const detailRes = await request(app.getHttpServer())
      .get(`/transport-jobs/${jobId}`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);
    expect(detailRes.body).not.toHaveProperty('revenue');
    expect(detailRes.body).not.toHaveProperty('netProfit');
    expect(detailRes.body).toHaveProperty('expensesTotal');
    expect(detailRes.body).toHaveProperty('expenses');
  });

  // Stage DM4 - regression test for a leak found while manually verifying
  // real responses: listJobs/getJob used to `include: { user: true }` on
  // the nested driver relation with no select, so the raw Prisma User row -
  // passwordHash included - was serialized straight into the response body.
  // DM4 is what first made this RIDER-reachable, but the same unselected
  // include also affected the OWNER/MANAGER response, so both are asserted
  // here rather than just the RIDER path.
  it('never includes passwordHash anywhere in a transport-jobs response, for a RIDER or for OWNER/MANAGER', async () => {
    const { accessToken } = await signupOwner(app);
    const a = await seedCarDriverAndVehicle(app, accessToken, 'G1');
    const jobId = await createJob(app, accessToken, a.motorcycleId, a.driverId);

    const ownerList = await request(app.getHttpServer())
      .get('/transport-jobs')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(JSON.stringify(ownerList.body)).not.toContain('passwordHash');

    const ownerDetail = await request(app.getHttpServer())
      .get(`/transport-jobs/${jobId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(JSON.stringify(ownerDetail.body)).not.toContain('passwordHash');

    const driverLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: a.driverEmail, password: 'driverpass123' })
      .expect(200);
    const driverToken = driverLogin.body.accessToken as string;

    const riderList = await request(app.getHttpServer())
      .get('/transport-jobs')
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);
    expect(JSON.stringify(riderList.body)).not.toContain('passwordHash');

    const riderDetail = await request(app.getHttpServer())
      .get(`/transport-jobs/${jobId}`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);
    expect(JSON.stringify(riderDetail.body)).not.toContain('passwordHash');
  });

  it('gets a clean 403 when a RIDER attempts to create, update, or delete a transport job', async () => {
    const { accessToken } = await signupOwner(app);
    const a = await seedCarDriverAndVehicle(app, accessToken, 'F1');
    const jobId = await createJob(app, accessToken, a.motorcycleId, a.driverId);

    const driverLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: a.driverEmail, password: 'driverpass123' })
      .expect(200);
    const driverToken = driverLogin.body.accessToken as string;

    await request(app.getHttpServer())
      .post('/transport-jobs')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        motorcycleId: a.motorcycleId,
        driverId: a.driverId,
        origin: 'X',
        destination: 'Y',
        revenue: 1000,
        scheduledDate: '2026-07-05',
      })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/transport-jobs/${jobId}`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ origin: 'Changed' })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/transport-jobs/${jobId}`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(403);
  });
});
