import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { GpsSource, UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/modules/auth/utils/password.util';
import { cleanDatabase, CLEAN_DATABASE_HOOK_TIMEOUT_MS } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';
import { signupAndActivateOwner } from './utils/verified-signup.util';

async function signupOwner(app: INestApplication, overrides: Partial<Record<string, string>> = {}) {
  const body = {
    email: 'owner@tracking-fleet.test',
    password: 'password123',
    companyName: 'Stealth Cargo Ltd',
    firstName: 'Ibrahim',
    lastName: 'Owner',
    phone: '+254700000601',
    ...overrides,
  };
  const { accessToken, tenantId } = await signupAndActivateOwner(app, body);
  return { accessToken, tenantId };
}

async function loginAs(
  prisma: PrismaService,
  app: INestApplication,
  tenantId: string,
  role: UserRole,
  email: string,
  phone: string,
) {
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

async function createMotorcycle(
  app: INestApplication,
  accessToken: string,
  registrationNumber: string,
) {
  const res = await request(app.getHttpServer())
    .post('/motorcycles')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ registrationNumber })
    .expect(201);
  return res.body.id as string;
}

describe('Tracking links (e2e, Stage I2, DESIGN_GPS_TRACKING.md §8)', () => {
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

  async function seedFix(
    tenantId: string,
    motorcycleId: string,
    minutesAgo: number,
    source: GpsSource = GpsSource.PHONE,
  ) {
    await prisma.client.gpsLocation.create({
      data: {
        tenantId,
        motorcycleId,
        source,
        latitude: -6.79,
        longitude: 39.2,
        recordedAt: new Date(Date.now() - minutesAgo * 60_000),
      },
    });
  }

  describe('management (OWNER/MANAGER)', () => {
    it('OWNER can create, list, and revoke; revoke is idempotent', async () => {
      const { accessToken } = await signupOwner(app);
      const motorcycleId = await createMotorcycle(app, accessToken, 'KDA-001A');

      const createRes = await request(app.getHttpServer())
        .post('/tracking-links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ motorcycleId, label: 'Delivery watch' })
        .expect(201);

      expect(createRes.body.status).toBe('ACTIVE');
      expect(createRes.body.token).toEqual(expect.any(String));
      expect(createRes.body.token.length).toBeGreaterThanOrEqual(40);

      const listRes = await request(app.getHttpServer())
        .get('/tracking-links')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].label).toBe('Delivery watch');

      const revokeRes = await request(app.getHttpServer())
        .patch(`/tracking-links/${createRes.body.id}/revoke`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(revokeRes.body.status).toBe('REVOKED');
      const firstRevokedAt = revokeRes.body.revokedAt;

      // Idempotent: a second revoke returns the SAME revokedAt, not a new one.
      const secondRevokeRes = await request(app.getHttpServer())
        .patch(`/tracking-links/${createRes.body.id}/revoke`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(secondRevokeRes.body.revokedAt).toBe(firstRevokedAt);
    });

    it('MANAGER can also create/list/revoke', async () => {
      const { accessToken: ownerToken, tenantId } = await signupOwner(app);
      const managerToken = await loginAs(
        prisma,
        app,
        tenantId,
        UserRole.MANAGER,
        'manager@tracking-fleet.test',
        '+254700000602',
      );
      void ownerToken;

      const createRes = await request(app.getHttpServer())
        .post('/tracking-links')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ label: 'Whole fleet' })
        .expect(201);

      await request(app.getHttpServer())
        .get('/tracking-links')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/tracking-links/${createRes.body.id}/revoke`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
    });

    it('rejects RIDER and MECHANIC with 403 on create/list/revoke', async () => {
      const { accessToken: ownerToken, tenantId } = await signupOwner(app);
      const createRes = await request(app.getHttpServer())
        .post('/tracking-links')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ label: 'x' })
        .expect(201);

      const riderToken = await loginAs(
        prisma,
        app,
        tenantId,
        UserRole.RIDER,
        'rider@tracking-fleet.test',
        '+254700000603',
      );
      const mechanicToken = await loginAs(
        prisma,
        app,
        tenantId,
        UserRole.MECHANIC,
        'mechanic@tracking-fleet.test',
        '+254700000604',
      );

      for (const token of [riderToken, mechanicToken]) {
        await request(app.getHttpServer())
          .post('/tracking-links')
          .set('Authorization', `Bearer ${token}`)
          .send({ label: 'x' })
          .expect(403);
        await request(app.getHttpServer())
          .get('/tracking-links')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
        await request(app.getHttpServer())
          .patch(`/tracking-links/${createRes.body.id}/revoke`)
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
      }
    });

    it('defaults expiresAt to ~7 days out when omitted, and honours an explicit null as "never"', async () => {
      const { accessToken } = await signupOwner(app);

      const defaulted = await request(app.getHttpServer())
        .post('/tracking-links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ label: 'default expiry' })
        .expect(201);
      const expiresAtMs = new Date(defaulted.body.expiresAt).getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(expiresAtMs).toBeGreaterThan(Date.now() + sevenDaysMs - 60_000);
      expect(expiresAtMs).toBeLessThan(Date.now() + sevenDaysMs + 60_000);

      const noExpiry = await request(app.getHttpServer())
        .post('/tracking-links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ label: 'never expires', expiresAt: null })
        .expect(201);
      expect(noExpiry.body.expiresAt).toBeNull();
    });
  });

  describe('public view', () => {
    it('a nonexistent, an expired, and a revoked token all 404 identically', async () => {
      const { accessToken } = await signupOwner(app);

      const expiredRes = await request(app.getHttpServer())
        .post('/tracking-links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ label: 'expired', expiresAt: '2020-01-01T00:00:00.000Z' })
        .expect(201);

      const revokedRes = await request(app.getHttpServer())
        .post('/tracking-links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ label: 'revoked' })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/tracking-links/${revokedRes.body.id}/revoke`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const nonexistent = await request(app.getHttpServer())
        .get('/public/track/this-token-does-not-exist')
        .expect(404);
      const expired = await request(app.getHttpServer())
        .get(`/public/track/${expiredRes.body.token}`)
        .expect(404);
      const revoked = await request(app.getHttpServer())
        .get(`/public/track/${revokedRes.body.token}`)
        .expect(404);

      expect(nonexistent.body.message).toEqual(expired.body.message);
      expect(expired.body.message).toEqual(revoked.body.message);
    });

    it('sets X-Robots-Tag: noindex on the public response', async () => {
      const { accessToken } = await signupOwner(app);
      const createRes = await request(app.getHttpServer())
        .post('/tracking-links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ label: 'x' })
        .expect(201);

      const res = await request(app.getHttpServer()).get(`/public/track/${createRes.body.token}`);
      expect(res.headers['x-robots-tag']).toBe('noindex');
    });

    it('single-vehicle: returns one object, increments viewCount, sets lastViewedAt, and leaks no forbidden fields', async () => {
      const { accessToken, tenantId } = await signupOwner(app);
      const motorcycleId = await createMotorcycle(app, accessToken, 'KDA-777Z');
      await seedFix(tenantId, motorcycleId, 1);

      // A driver whose real name/phone must never appear in the public
      // response - this is the whole point of the whitelist-DTO requirement.
      await request(app.getHttpServer())
        .post('/drivers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          firstName: 'Amina',
          lastName: 'Hassan',
          phone: '+254799999999',
          email: 'amina.hassan@tracking-fleet.test',
          licenseNumber: 'LIC-AMINA',
          initialPassword: 'riderpass123',
        })
        .expect(201);

      const createRes = await request(app.getHttpServer())
        .post('/tracking-links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ motorcycleId, label: 'Single vehicle' })
        .expect(201);

      const viewRes = await request(app.getHttpServer())
        .get(`/public/track/${createRes.body.token}`)
        .expect(200);

      expect(Array.isArray(viewRes.body)).toBe(false);
      expect(viewRes.body).toEqual({
        registrationNumber: 'KDA-777Z',
        offline: false,
        latitude: -6.79,
        longitude: 39.2,
        recordedAt: expect.any(String),
        source: 'PHONE',
      });

      const raw = JSON.stringify(viewRes.body);
      for (const forbidden of [
        'Amina',
        'Hassan',
        '799999999',
        'Stealth Cargo',
        'passwordHash',
        'tenantId',
        'driverId',
        'targetAmount',
        'label',
        'token',
      ]) {
        expect(raw).not.toContain(forbidden);
      }

      const listRes = await request(app.getHttpServer())
        .get('/tracking-links')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const link = listRes.body.find((l: { id: string }) => l.id === createRes.body.id);
      expect(link.viewCount).toBe(1);
      expect(link.lastViewedAt).toEqual(expect.any(String));

      // A second view increments again.
      await request(app.getHttpServer()).get(`/public/track/${createRes.body.token}`).expect(200);
      const listRes2 = await request(app.getHttpServer())
        .get('/tracking-links')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const link2 = listRes2.body.find((l: { id: string }) => l.id === createRes.body.id);
      expect(link2.viewCount).toBe(2);
    });

    it('a vehicle with only a stale fix reports offline: true with a lastKnownAt age', async () => {
      const { accessToken, tenantId } = await signupOwner(app);
      const motorcycleId = await createMotorcycle(app, accessToken, 'KDA-STALE');
      await seedFix(tenantId, motorcycleId, 60); // well past GPS_STALE_AFTER_MINUTES

      const createRes = await request(app.getHttpServer())
        .post('/tracking-links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ motorcycleId, label: 'Stale vehicle' })
        .expect(201);

      const viewRes = await request(app.getHttpServer())
        .get(`/public/track/${createRes.body.token}`)
        .expect(200);

      expect(viewRes.body.offline).toBe(true);
      expect(viewRes.body.lastKnownAt).toEqual(expect.any(String));
      expect(viewRes.body.latitude).toBeUndefined();
    });

    it('a vehicle with no GPS history at all reports offline with lastKnownAt: null', async () => {
      const { accessToken } = await signupOwner(app);
      const motorcycleId = await createMotorcycle(app, accessToken, 'KDA-NEVER');

      const createRes = await request(app.getHttpServer())
        .post('/tracking-links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ motorcycleId, label: 'Never reported' })
        .expect(201);

      const viewRes = await request(app.getHttpServer())
        .get(`/public/track/${createRes.body.token}`)
        .expect(200);

      expect(viewRes.body).toEqual({
        registrationNumber: 'KDA-NEVER',
        offline: true,
        lastKnownAt: null,
      });
    });

    it("whole-fleet: returns an array, one entry per motorcycle that has ever reported - never one that hasn't", async () => {
      const { accessToken, tenantId } = await signupOwner(app);
      const onlineId = await createMotorcycle(app, accessToken, 'KDA-ONLINE');
      const staleId = await createMotorcycle(app, accessToken, 'KDA-OFFLINE');
      await createMotorcycle(app, accessToken, 'KDA-NEVER-REPORTED'); // deliberately no fix

      await seedFix(tenantId, onlineId, 1);
      await seedFix(tenantId, staleId, 60);

      const createRes = await request(app.getHttpServer())
        .post('/tracking-links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ label: 'Whole fleet' }) // motorcycleId omitted
        .expect(201);
      expect(createRes.body.motorcycleId).toBeNull();

      const viewRes = await request(app.getHttpServer())
        .get(`/public/track/${createRes.body.token}`)
        .expect(200);

      expect(Array.isArray(viewRes.body)).toBe(true);
      expect(viewRes.body).toHaveLength(2);
      const byReg = new Map(
        (viewRes.body as Array<{ registrationNumber: string }>).map((v) => [
          v.registrationNumber,
          v,
        ]),
      );
      expect(byReg.get('KDA-ONLINE')).toEqual(
        expect.objectContaining({ offline: false, source: 'PHONE' }),
      );
      expect(byReg.get('KDA-OFFLINE')).toEqual(expect.objectContaining({ offline: true }));
      expect(byReg.has('KDA-NEVER-REPORTED')).toBe(false);
    });

    it('prefers a DEVICE fix over a newer PHONE fix within the preference window, end to end', async () => {
      const { accessToken, tenantId } = await signupOwner(app);
      const motorcycleId = await createMotorcycle(app, accessToken, 'KDA-DEV1');
      await seedFix(tenantId, motorcycleId, 0.5, GpsSource.PHONE);
      await seedFix(tenantId, motorcycleId, 1.5, GpsSource.DEVICE);

      const createRes = await request(app.getHttpServer())
        .post('/tracking-links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ motorcycleId, label: 'x' })
        .expect(201);

      const viewRes = await request(app.getHttpServer())
        .get(`/public/track/${createRes.body.token}`)
        .expect(200);

      expect(viewRes.body.source).toBe('DEVICE');
    });
  });
});
