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
import { signupAndActivateOwner } from './utils/verified-signup.util';

async function signupOwner(app: INestApplication, email: string, company: string) {
  const { accessToken } = await signupAndActivateOwner(app, {
    email,
    password: 'password123',
    companyName: company,
    firstName: 'Own',
    lastName: 'Er',
    phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
  });
  return accessToken;
}

async function seedUser(prisma: PrismaService, tenantId: string, role: UserRole, tag: string) {
  const email = `${role.toLowerCase()}-${tag.toLowerCase()}@test.local`;
  await prisma.client.user.create({
    data: {
      tenantId,
      email,
      phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
      passwordHash: await hashPassword('password123'),
      role,
      firstName: role,
      lastName: tag,
    },
  });
  return { email, password: 'password123' };
}

async function loginAs(app: INestApplication, email: string, password: string) {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken as string;
}

async function setupRider(app: INestApplication, ownerToken: string, tag: string) {
  const email = `rider-${tag.toLowerCase()}@test.local`;
  const driverRes = await request(app.getHttpServer())
    .post('/drivers')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      firstName: 'Rita',
      lastName: tag,
      phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
      email,
      licenseNumber: `LIC-${tag}`,
      initialPassword: 'riderpass123',
    })
    .expect(201);
  const motoRes = await request(app.getHttpServer())
    .post('/motorcycles')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ registrationNumber: `REG-${tag}` })
    .expect(201);
  return {
    driverId: driverRes.body.id as string,
    driverEmail: email,
    motorcycleId: motoRes.body.id as string,
  };
}

async function assignDay(
  app: INestApplication,
  ownerToken: string,
  driverId: string,
  motorcycleId: string,
  assignedDate: string,
) {
  await request(app.getHttpServer())
    .post('/assignments')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ driverId, motorcycleId, assignedDate, targetAmount: 10000 })
    .expect(201);
}

async function loginRider(app: INestApplication, email: string) {
  return loginAs(app, email, 'riderpass123');
}

describe('GPS phone reporting (e2e)', () => {
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

  it("a RIDER's batch is stored with the right source/driverId/motorcycleId, resolved from their own assignment - not the client", async () => {
    const ownerToken = await signupOwner(app, 'owner-gps1@fleet.test', 'Fleet GPS1');
    const { driverId, driverEmail, motorcycleId } = await setupRider(app, ownerToken, 'G1');
    await assignDay(app, ownerToken, driverId, motorcycleId, '2026-08-10');
    const riderToken = await loginRider(app, driverEmail);

    const res = await request(app.getHttpServer())
      .post('/gps/phone')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({
        fixes: [
          {
            recordedAt: '2026-08-10T09:00:00.000Z',
            latitude: -6.79,
            longitude: 39.2,
            speedKmh: 24.5,
            heading: 118,
            accuracyMeters: 12,
            batteryPercent: 64,
          },
        ],
      })
      .expect(201);

    expect(res.body).toEqual({ accepted: 1, discarded: 0 });

    const rows = await requestContext.runUnscoped(() =>
      prisma.client.gpsLocation.findMany({ where: { motorcycleId } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        source: 'PHONE',
        driverId,
        motorcycleId,
        latitude: -6.79,
        longitude: 39.2,
        batteryPercent: 64,
      }),
    );
  });

  it('a fix with no assignment on its date is discarded, not erroring the rest of the batch', async () => {
    const ownerToken = await signupOwner(app, 'owner-gps2@fleet.test', 'Fleet GPS2');
    const { driverId, driverEmail, motorcycleId } = await setupRider(app, ownerToken, 'G2');
    await assignDay(app, ownerToken, driverId, motorcycleId, '2026-08-10');
    const riderToken = await loginRider(app, driverEmail);

    const res = await request(app.getHttpServer())
      .post('/gps/phone')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({
        fixes: [
          { recordedAt: '2026-08-10T09:00:00.000Z', latitude: -6.79, longitude: 39.2 },
          { recordedAt: '2026-08-01T09:00:00.000Z', latitude: -6.8, longitude: 39.21 },
        ],
      })
      .expect(201);

    expect(res.body).toEqual({ accepted: 1, discarded: 1 });
    const rows = await requestContext.runUnscoped(() =>
      prisma.client.gpsLocation.findMany({ where: { motorcycleId } }),
    );
    expect(rows).toHaveLength(1);
  });

  it('rejects OWNER, MANAGER, and MECHANIC with 403', async () => {
    const ownerToken = await signupOwner(app, 'owner-gps3@fleet.test', 'Fleet GPS3');
    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const tenantId = meRes.body.tenantId as string;

    const manager = await seedUser(prisma, tenantId, UserRole.MANAGER, 'G3');
    const mechanic = await seedUser(prisma, tenantId, UserRole.MECHANIC, 'G3');
    const managerToken = await loginAs(app, manager.email, manager.password);
    const mechanicToken = await loginAs(app, mechanic.email, mechanic.password);

    const body = {
      fixes: [{ recordedAt: '2026-08-10T09:00:00.000Z', latitude: -6.79, longitude: 39.2 }],
    };

    await request(app.getHttpServer())
      .post('/gps/phone')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .post('/gps/phone')
      .set('Authorization', `Bearer ${managerToken}`)
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .post('/gps/phone')
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send(body)
      .expect(403);
  });

  it('rejects a batch over 500 fixes with a 400, rather than truncating it', async () => {
    const ownerToken = await signupOwner(app, 'owner-gps4@fleet.test', 'Fleet GPS4');
    const { driverEmail } = await setupRider(app, ownerToken, 'G4');
    const riderToken = await loginRider(app, driverEmail);

    const fixes = Array.from({ length: 501 }, (_, i) => ({
      recordedAt: `2026-08-10T${String(9 + (i % 10)).padStart(2, '0')}:00:00.000Z`,
      latitude: -6.79,
      longitude: 39.2,
    }));

    await request(app.getHttpServer())
      .post('/gps/phone')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ fixes })
      .expect(400);
  });
});
