import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanDatabase, CLEAN_DATABASE_HOOK_TIMEOUT_MS } from './utils/prisma-test.util';
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

async function createDriver(
  app: INestApplication,
  accessToken: string,
  overrides: Partial<Record<string, string>> = {},
) {
  const body = {
    firstName: 'Juma',
    lastName: 'Bakari',
    phone: '+254711111111',
    email: 'juma@acme-fleet.test',
    licenseNumber: 'LIC-001',
    initialPassword: 'password123',
    ...overrides,
  };
  const res = await request(app.getHttpServer())
    .post('/drivers')
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body)
    .expect(201);
  return res.body as { id: string };
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
  return res.body as { id: string };
}

async function assignVehicle(
  app: INestApplication,
  accessToken: string,
  driverId: string,
  motorcycleId: string,
  assignedDate: string,
) {
  await request(app.getHttpServer())
    .post('/assignments')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ driverId, motorcycleId, assignedDate, targetAmount: 15000 })
    .expect(201);
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

describe('Driver search (e2e)', () => {
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

  it('matches on name, independently of phone or plate', async () => {
    const { accessToken } = await signupOwner(app);
    await createDriver(app, accessToken, {
      firstName: 'Juma',
      lastName: 'Bakari',
      phone: '+254711111111',
      email: 'juma@acme-fleet.test',
      licenseNumber: 'LIC-J1',
    });
    await createDriver(app, accessToken, {
      firstName: 'Neema',
      lastName: 'Paul',
      phone: '+254722222222',
      email: 'neema@acme-fleet.test',
      licenseNumber: 'LIC-N1',
    });

    const res = await request(app.getHttpServer())
      .get('/drivers/search')
      .query({ q: 'Bakari' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].lastName).toBe('Bakari');
  });

  it('matches on phone number, independently of name or plate', async () => {
    const { accessToken } = await signupOwner(app);
    await createDriver(app, accessToken, {
      firstName: 'Juma',
      lastName: 'Bakari',
      phone: '+254711111111',
      email: 'juma@acme-fleet.test',
      licenseNumber: 'LIC-J1',
    });
    await createDriver(app, accessToken, {
      firstName: 'Neema',
      lastName: 'Paul',
      phone: '+254722222222',
      email: 'neema@acme-fleet.test',
      licenseNumber: 'LIC-N1',
    });

    const res = await request(app.getHttpServer())
      .get('/drivers/search')
      .query({ q: '722222' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].phone).toBe('+254722222222');
  });

  it('matches on vehicle registration plate, independently of name or phone', async () => {
    const { accessToken } = await signupOwner(app);
    const driver1 = await createDriver(app, accessToken, {
      firstName: 'Juma',
      lastName: 'Bakari',
      phone: '+254711111111',
      email: 'juma@acme-fleet.test',
      licenseNumber: 'LIC-J1',
    });
    await createDriver(app, accessToken, {
      firstName: 'Neema',
      lastName: 'Paul',
      phone: '+254722222222',
      email: 'neema@acme-fleet.test',
      licenseNumber: 'LIC-N1',
    });
    const motorcycle = await createMotorcycle(app, accessToken, 'T123 ABC');
    await assignVehicle(app, accessToken, driver1.id, motorcycle.id, todayDateString());

    const res = await request(app.getHttpServer())
      .get('/drivers/search')
      .query({ q: 'T123' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].lastName).toBe('Bakari');
    expect(res.body.results[0].registrationNumber).toBe('T123 ABC');
  });

  it('matches a partial, lowercase query against a mixed-case name', async () => {
    const { accessToken } = await signupOwner(app);
    await createDriver(app, accessToken, {
      firstName: 'JUMA',
      lastName: 'BAKARI',
      phone: '+254711111111',
      email: 'juma@acme-fleet.test',
      licenseNumber: 'LIC-J1',
    });

    const res = await request(app.getHttpServer())
      .get('/drivers/search')
      .query({ q: 'bak' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].lastName).toBe('BAKARI');
  });

  it("is tenant-scoped: another tenant's matching driver never appears", async () => {
    const { accessToken: ownerAToken } = await signupOwner(app);
    await createDriver(app, ownerAToken, {
      firstName: 'Juma',
      lastName: 'Bakari',
      phone: '+254711111111',
      email: 'juma@acme-fleet.test',
      licenseNumber: 'LIC-J1',
    });

    const { accessToken: ownerBToken } = await signupOwner(app, {
      email: 'owner-b@other-fleet.test',
      companyName: 'Other Fleet',
      phone: '+254700000099',
    });
    await createDriver(app, ownerBToken, {
      firstName: 'Juma',
      lastName: 'Mbogo',
      phone: '+254733333333',
      email: 'juma-b@other-fleet.test',
      licenseNumber: 'LIC-J2',
    });

    const res = await request(app.getHttpServer())
      .get('/drivers/search')
      .query({ q: 'Juma' })
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(200);

    // Owner B's own Juma matches; owner A's namesake must not leak in.
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].lastName).toBe('Mbogo');
  });

  it('caps results and signals hasMore rather than truncating silently', async () => {
    const { accessToken } = await signupOwner(app);
    for (let i = 0; i < 3; i += 1) {
      await createDriver(app, accessToken, {
        firstName: 'Juma',
        lastName: `Candidate${i}`,
        phone: `+25471111100${i}`,
        email: `juma${i}@acme-fleet.test`,
        licenseNumber: `LIC-J${i}`,
      });
    }

    const capped = await request(app.getHttpServer())
      .get('/drivers/search')
      .query({ q: 'Juma', limit: 2 })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(capped.body.results).toHaveLength(2);
    expect(capped.body.hasMore).toBe(true);

    const uncapped = await request(app.getHttpServer())
      .get('/drivers/search')
      .query({ q: 'Juma', limit: 10 })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(uncapped.body.results).toHaveLength(3);
    expect(uncapped.body.hasMore).toBe(false);
  });

  it("rejects a DRIVER-role token with 403 - drivers have rider-app logins, and this endpoint returns every driver in the fleet's name, phone, and plate, not just the caller's own", async () => {
    const { accessToken } = await signupOwner(app);
    await createDriver(app, accessToken, {
      firstName: 'Juma',
      lastName: 'Bakari',
      phone: '+254711111111',
      email: 'juma@acme-fleet.test',
      licenseNumber: 'LIC-J1',
      initialPassword: 'password123',
    });

    const driverLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'juma@acme-fleet.test', password: 'password123' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/drivers/search')
      .query({ q: 'Juma' })
      .set('Authorization', `Bearer ${driverLogin.body.accessToken}`)
      .expect(403);
  });

  it('pins route ordering: GET /drivers/search hits the search handler, not GET /drivers/:id with id="search"', async () => {
    const { accessToken } = await signupOwner(app);
    await createDriver(app, accessToken, {
      firstName: 'Juma',
      lastName: 'Bakari',
      phone: '+254711111111',
      email: 'juma@acme-fleet.test',
      licenseNumber: 'LIC-J1',
    });

    const res = await request(app.getHttpServer())
      .get('/drivers/search')
      .query({ q: 'Juma' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    // No driver has the literal id "search" - if `:id` ever matched ahead of
    // `search` again (e.g. a reordered decorator), this request would 404
    // instead of returning the search response shape, and this assertion
    // would catch it instead of the feature just quietly stopping working.
    expect(res.body).toEqual(
      expect.objectContaining({ results: expect.any(Array), hasMore: expect.any(Boolean) }),
    );
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toEqual(
      expect.objectContaining({ id: expect.any(String), firstName: 'Juma', lastName: 'Bakari' }),
    );
  });
});
