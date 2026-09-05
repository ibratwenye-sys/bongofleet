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
    email: 'owner@map-fleet.test',
    password: 'password123',
    companyName: 'Map Fleet',
    firstName: 'Ibrahim',
    lastName: 'Owner',
    phone: '+254700000701',
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
  vehicleType?: string,
) {
  const res = await request(app.getHttpServer())
    .post('/motorcycles')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ registrationNumber, ...(vehicleType ? { vehicleType } : {}) })
    .expect(201);
  return res.body.id as string;
}

describe('GPS fleet map (e2e, Stage I3, DESIGN_GPS_TRACKING.md §7)', () => {
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
    recordedAt: Date,
    source: GpsSource = GpsSource.PHONE,
    overrides: Partial<{ latitude: number; longitude: number; speedKmh: number | null }> = {},
  ) {
    await prisma.client.gpsLocation.create({
      data: {
        tenantId,
        motorcycleId,
        source,
        latitude: overrides.latitude ?? -6.79,
        longitude: overrides.longitude ?? 39.2,
        speedKmh: overrides.speedKmh,
        recordedAt,
      },
    });
  }

  describe('GET /gps/fleet-positions', () => {
    it('rejects RIDER and MECHANIC with 403', async () => {
      const { accessToken: ownerToken, tenantId } = await signupOwner(app);
      const riderToken = await loginAs(
        prisma,
        app,
        tenantId,
        UserRole.RIDER,
        'rider@map-fleet.test',
        '+254700000702',
      );
      const mechanicToken = await loginAs(
        prisma,
        app,
        tenantId,
        UserRole.MECHANIC,
        'mechanic@map-fleet.test',
        '+254700000703',
      );
      void ownerToken;

      for (const token of [riderToken, mechanicToken]) {
        await request(app.getHttpServer())
          .get('/gps/fleet-positions')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
      }
    });

    it('OWNER and MANAGER both get 200 with every active vehicle, live/offline resolved correctly', async () => {
      const { accessToken: ownerToken, tenantId } = await signupOwner(app);
      const managerToken = await loginAs(
        prisma,
        app,
        tenantId,
        UserRole.MANAGER,
        'manager@map-fleet.test',
        '+254700000704',
      );

      const liveId = await createMotorcycle(app, ownerToken, 'KDA-LIVE', 'MOTORBIKE');
      const staleId = await createMotorcycle(app, ownerToken, 'KDA-STALE', 'CAR');
      const neverId = await createMotorcycle(app, ownerToken, 'KDA-NEVER', 'TRUCK');
      const inactiveId = await createMotorcycle(app, ownerToken, 'KDA-INACTIVE');
      await request(app.getHttpServer())
        .delete(`/motorcycles/${inactiveId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      await seedFix(tenantId, liveId, new Date(Date.now() - 60_000));
      await seedFix(tenantId, staleId, new Date(Date.now() - 60 * 60_000));

      const res = await request(app.getHttpServer())
        .get('/gps/fleet-positions')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect(res.body).toHaveLength(3); // inactive vehicle excluded
      const byId = new Map(res.body.map((v: { motorcycleId: string }) => [v.motorcycleId, v]));
      expect(byId.get(liveId)).toEqual(
        expect.objectContaining({
          registrationNumber: 'KDA-LIVE',
          vehicleType: 'MOTORBIKE',
          offline: false,
          source: 'PHONE',
        }),
      );
      expect(byId.get(staleId)).toEqual(
        expect.objectContaining({ registrationNumber: 'KDA-STALE', offline: true }),
      );
      expect((byId.get(staleId) as { lastRecordedAt: string }).lastRecordedAt).toEqual(
        expect.any(String),
      );
      expect(byId.get(neverId)).toEqual({
        motorcycleId: neverId,
        registrationNumber: 'KDA-NEVER',
        vehicleType: 'TRUCK',
        // Stage (DESIGN_GPS_TRACKING.md §6) - trackingMode is a new, additive
        // field on this response; PHONE is Motorcycle's own schema default,
        // never set explicitly by createMotorcycle() in this test.
        trackingMode: 'PHONE',
        offline: true,
        lastRecordedAt: null,
      });
      expect(byId.has(inactiveId)).toBe(false);
    });

    it('only ever returns this tenant’s own vehicles', async () => {
      const { accessToken: ownerAToken } = await signupOwner(app, {
        email: 'owner-a@map-fleet.test',
        companyName: 'Fleet A',
        phone: '+254700000705',
      });
      const { accessToken: ownerBToken } = await signupOwner(app, {
        email: 'owner-b@map-fleet.test',
        companyName: 'Fleet B',
        phone: '+254700000706',
      });
      await createMotorcycle(app, ownerAToken, 'KDA-FLEETA');
      await createMotorcycle(app, ownerBToken, 'KDA-FLEETB');

      const res = await request(app.getHttpServer())
        .get('/gps/fleet-positions')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].registrationNumber).toBe('KDA-FLEETA');
    });
  });

  describe('GET /gps/vehicles/:motorcycleId/path', () => {
    it('rejects RIDER and MECHANIC with 403', async () => {
      const { accessToken: ownerToken, tenantId } = await signupOwner(app);
      const motorcycleId = await createMotorcycle(app, ownerToken, 'KDA-001A');
      const riderToken = await loginAs(
        prisma,
        app,
        tenantId,
        UserRole.RIDER,
        'rider2@map-fleet.test',
        '+254700000707',
      );

      await request(app.getHttpServer())
        .get(`/gps/vehicles/${motorcycleId}/path`)
        .query({ date: '2026-08-20' })
        .set('Authorization', `Bearer ${riderToken}`)
        .expect(403);
    });

    it('404s for a nonexistent motorcycle', async () => {
      const { accessToken } = await signupOwner(app);

      await request(app.getHttpServer())
        .get('/gps/vehicles/does-not-exist/path')
        .query({ date: '2026-08-20' })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });

    it("404s for another tenant's motorcycle", async () => {
      const { accessToken: ownerAToken } = await signupOwner(app, {
        email: 'owner-a2@map-fleet.test',
        companyName: 'Fleet A2',
        phone: '+254700000708',
      });
      const { accessToken: ownerBToken } = await signupOwner(app, {
        email: 'owner-b2@map-fleet.test',
        companyName: 'Fleet B2',
        phone: '+254700000709',
      });
      const bMotorcycleId = await createMotorcycle(app, ownerBToken, 'KDA-FLEETB2');

      await request(app.getHttpServer())
        .get(`/gps/vehicles/${bMotorcycleId}/path`)
        .query({ date: '2026-08-20' })
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(404);
    });

    it('returns only fixes within the requested Africa/Dar_es_Salaam calendar day, ordered oldest first', async () => {
      const { accessToken, tenantId } = await signupOwner(app);
      const motorcycleId = await createMotorcycle(app, accessToken, 'KDA-PATH');

      // 2026-08-20 local (Dar es Salaam, UTC+3) spans 2026-08-19T21:00:00Z
      // to 2026-08-20T21:00:00Z.
      await seedFix(tenantId, motorcycleId, new Date('2026-08-19T20:00:00.000Z')); // previous day - excluded
      await seedFix(tenantId, motorcycleId, new Date('2026-08-20T09:00:00.000Z'), GpsSource.PHONE, {
        latitude: -6.79,
        longitude: 39.2,
        speedKmh: 20,
      });
      await seedFix(tenantId, motorcycleId, new Date('2026-08-20T10:00:00.000Z'), GpsSource.PHONE, {
        latitude: -6.8,
        longitude: 39.21,
        speedKmh: 25,
      });
      await seedFix(tenantId, motorcycleId, new Date('2026-08-20T21:00:00.000Z')); // next day - excluded (boundary)

      const res = await request(app.getHttpServer())
        .get(`/gps/vehicles/${motorcycleId}/path`)
        .query({ date: '2026-08-20' })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toEqual({
        recordedAt: '2026-08-20T09:00:00.000Z',
        latitude: -6.79,
        longitude: 39.2,
        speedKmh: 20,
      });
      expect(res.body[1].recordedAt).toBe('2026-08-20T10:00:00.000Z');
    });

    it('a date with no fixes returns an empty array, not an error', async () => {
      const { accessToken } = await signupOwner(app);
      const motorcycleId = await createMotorcycle(app, accessToken, 'KDA-EMPTY');

      const res = await request(app.getHttpServer())
        .get(`/gps/vehicles/${motorcycleId}/path`)
        .query({ date: '2026-08-20' })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('rejects a malformed date with 400', async () => {
      const { accessToken } = await signupOwner(app);
      const motorcycleId = await createMotorcycle(app, accessToken, 'KDA-BADDATE');

      await request(app.getHttpServer())
        .get(`/gps/vehicles/${motorcycleId}/path`)
        .query({ date: 'not-a-date' })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);
    });
  });
});
