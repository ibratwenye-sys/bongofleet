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
  const { accessToken, tenantId } = await signupAndActivateOwner(app, {
    email,
    password: 'password123',
    companyName: company,
    firstName: 'Own',
    lastName: 'Er',
    phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
  });
  return { accessToken, tenantId };
}

async function seedManager(prisma: PrismaService, tenantId: string, tag: string) {
  const email = `manager-${tag.toLowerCase()}@test.local`;
  await prisma.client.user.create({
    data: {
      tenantId,
      email,
      phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
      passwordHash: await hashPassword('managerpass123'),
      role: UserRole.MANAGER,
      firstName: 'Man',
      lastName: tag,
    },
  });
  return { email, password: 'managerpass123' };
}

async function seedRider(app: INestApplication, ownerToken: string, tag: string) {
  const email = `rider-${tag.toLowerCase()}@test.local`;
  await request(app.getHttpServer())
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
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: 'riderpass123' })
    .expect(200);
  return res.body.accessToken as string;
}

describe('GPS provider config (e2e)', () => {
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

  it('GET returns null when nothing is configured yet for this tenant', async () => {
    const { accessToken } = await signupOwner(app, 'owner-empty@fleet.test', 'Fleet Empty');
    const res = await request(app.getHttpServer())
      .get('/gps-provider-config')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body).toBeNull();
  });

  it('OWNER can PUT then GET their own config; the response never contains the plaintext token', async () => {
    const { accessToken } = await signupOwner(app, 'owner-put@fleet.test', 'Fleet Put');
    const secretToken = 'super-secret-traccar-token-xyz123';

    const putRes = await request(app.getHttpServer())
      .put('/gps-provider-config')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ baseUrl: 'https://demo.traccar.org', token: secretToken })
      .expect(200);

    expect(putRes.body).toEqual({
      baseUrl: 'https://demo.traccar.org',
      isActive: true,
      lastPolledAt: null,
      lastSuccessAt: null,
      lastErrorMessage: null,
      hasCredentials: true,
    });

    const getRes = await request(app.getHttpServer())
      .get('/gps-provider-config')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(getRes.body).toEqual(putRes.body);

    // Leak-sweep, same pattern tracking-link.e2e-spec.ts's own public-track
    // test already uses: the raw plaintext token must never appear
    // anywhere in either response body, and neither must the raw column
    // name that stores its encrypted form.
    for (const res of [putRes, getRes]) {
      const raw = JSON.stringify(res.body);
      for (const forbidden of [secretToken, 'credentialsEncrypted', 'credentials_encrypted']) {
        expect(raw).not.toContain(forbidden);
      }
    }
  });

  it('a trailing slash on baseUrl is normalized away', async () => {
    const { accessToken } = await signupOwner(app, 'owner-trail@fleet.test', 'Fleet Trail');
    const res = await request(app.getHttpServer())
      .put('/gps-provider-config')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ baseUrl: 'https://demo.traccar.org/', token: 'tok-1' })
      .expect(200);
    expect(res.body.baseUrl).toBe('https://demo.traccar.org');
  });

  it('PUT resets a prior lastErrorMessage and reactivates a deactivated config', async () => {
    const { accessToken, tenantId } = await signupOwner(
      app,
      'owner-reset@fleet.test',
      'Fleet Reset',
    );
    await request(app.getHttpServer())
      .put('/gps-provider-config')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ baseUrl: 'https://demo.traccar.org', token: 'tok-1' })
      .expect(200);

    // Simulate a failed poll and a deactivation - no API sets
    // lastErrorMessage (only the polling cron does), so this is seeded
    // directly, same convention expense.e2e-spec.ts's own lifecycle test
    // uses to reach a state no endpoint can put a row in directly.
    await requestContext.runUnscoped(() =>
      prisma.client.gpsProviderConfig.updateMany({
        where: { tenantId },
        data: { lastErrorMessage: 'Traccar returned 401', isActive: false },
      }),
    );

    const res = await request(app.getHttpServer())
      .put('/gps-provider-config')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ baseUrl: 'https://demo.traccar.org', token: 'tok-2-corrected' })
      .expect(200);

    expect(res.body.lastErrorMessage).toBeNull();
    expect(res.body.isActive).toBe(true);
  });

  it('PATCH deactivate sets isActive false; deactivating with none configured 404s', async () => {
    const { accessToken } = await signupOwner(app, 'owner-deact@fleet.test', 'Fleet Deact');

    await request(app.getHttpServer())
      .patch('/gps-provider-config/deactivate')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .put('/gps-provider-config')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ baseUrl: 'https://demo.traccar.org', token: 'tok-1' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch('/gps-provider-config/deactivate')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.isActive).toBe(false);

    const getRes = await request(app.getHttpServer())
      .get('/gps-provider-config')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(getRes.body.isActive).toBe(false);
  });

  it('MANAGER and RIDER are forbidden from every route (OWNER only)', async () => {
    const { accessToken, tenantId } = await signupOwner(
      app,
      'owner-roles@fleet.test',
      'Fleet Roles',
    );
    const manager = await seedManager(prisma, tenantId, 'Roles1');
    const managerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: manager.email, password: manager.password })
      .expect(200);
    const managerToken = managerLogin.body.accessToken as string;
    const riderToken = await seedRider(app, accessToken, 'Roles1');

    for (const token of [managerToken, riderToken]) {
      await request(app.getHttpServer())
        .get('/gps-provider-config')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      await request(app.getHttpServer())
        .put('/gps-provider-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ baseUrl: 'https://demo.traccar.org', token: 'tok-1' })
        .expect(403);
      await request(app.getHttpServer())
        .patch('/gps-provider-config/deactivate')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    }
  });

  it("isolates config across tenants - tenant B's OWNER never sees tenant A's config", async () => {
    const a = await signupOwner(app, 'owner-tenant-a@fleet.test', 'Fleet Tenant A');
    const secretToken = 'tenant-a-only-secret-token';
    await request(app.getHttpServer())
      .put('/gps-provider-config')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ baseUrl: 'https://a.traccar.example', token: secretToken })
      .expect(200);

    const b = await signupOwner(app, 'owner-tenant-b@fleet.test', 'Fleet Tenant B');
    const getRes = await request(app.getHttpServer())
      .get('/gps-provider-config')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    expect(getRes.body).toBeNull();

    // B deactivating "their" config must 404, not silently touch A's row.
    await request(app.getHttpServer())
      .patch('/gps-provider-config/deactivate')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(404);

    const aStillActive = await request(app.getHttpServer())
      .get('/gps-provider-config')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
    expect(aStillActive.body.isActive).toBe(true);
    expect(JSON.stringify(aStillActive.body)).not.toContain(secretToken);
  });
});
