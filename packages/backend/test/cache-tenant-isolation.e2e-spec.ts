import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanDatabase, CLEAN_DATABASE_HOOK_TIMEOUT_MS } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';
import { signupAndActivateOwner } from './utils/verified-signup.util';

async function signupOwner(app: INestApplication, email: string, companyName: string) {
  const { accessToken, tenantId } = await signupAndActivateOwner(app, {
    email,
    password: 'password123',
    companyName,
    firstName: 'Own',
    lastName: 'Er',
    phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
  });
  return { accessToken, tenantId };
}

function listMotorcycles(app: INestApplication, token: string) {
  return request(app.getHttpServer())
    .get('/motorcycles')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
}

function createMotorcycle(app: INestApplication, token: string, registrationNumber: string) {
  return request(app.getHttpServer())
    .post('/motorcycles')
    .set('Authorization', `Bearer ${token}`)
    .send({ registrationNumber })
    .expect(201);
}

/**
 * The one test that actually matters for the Redis caching layer (Stage 2):
 * TenantCacheService keys every entry as tenant:{tenantId}:<resource>:
 * <params>, never a bare resource name - the built-in CacheInterceptor is
 * deliberately NOT used anywhere in this app precisely because it keys off
 * the request URL by default, and GET /motorcycles is the same URL for
 * every tenant. This proves that discipline actually holds at the HTTP
 * layer, not just in the key-building code: warm the cache for one tenant,
 * then confirm a different tenant hitting the exact same route never sees
 * it - the same failure shape as the fail-closed Prisma tenant-scoping
 * extension exists to prevent everywhere else in this codebase.
 */
describe('Cache tenant isolation (e2e)', () => {
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

  it("warming tenant A's motorcycle-list cache never leaks into tenant B's request for the same route", async () => {
    const a = await signupOwner(app, 'owner-a@fleet-a.test', 'Fleet A');
    await createMotorcycle(app, a.accessToken, 'KDA-100A');

    // Warms tenant A's cache entry (tenant:{A}:motorcycles:default).
    const firstA = await listMotorcycles(app, a.accessToken);
    expect(firstA.body).toHaveLength(1);
    expect(firstA.body[0].registrationNumber).toBe('KDA-100A');

    // Tenant B signs up AFTER A's cache is warm, has never created anything.
    // A bare-resource-name key (the CacheInterceptor default this layer
    // deliberately avoids) would serve A's cached list here.
    const b = await signupOwner(app, 'owner-b@fleet-b.test', 'Fleet B');
    const firstB = await listMotorcycles(app, b.accessToken);
    expect(firstB.body).toEqual([]);

    // B creates its own motorcycle, warming B's own cache entry.
    await createMotorcycle(app, b.accessToken, 'KDB-200B');
    const secondB = await listMotorcycles(app, b.accessToken);
    expect(secondB.body).toHaveLength(1);
    expect(secondB.body[0].registrationNumber).toBe('KDB-200B');

    // A's cached view is still exactly A's own, unaffected by B's write -
    // proves invalidation is also tenant-scoped, not a shared bust.
    const secondA = await listMotorcycles(app, a.accessToken);
    expect(secondA.body).toHaveLength(1);
    expect(secondA.body[0].registrationNumber).toBe('KDA-100A');
  });

  it('a write invalidates only the writing tenant, and the next read reflects it', async () => {
    const a = await signupOwner(app, 'owner-c@fleet-c.test', 'Fleet C');
    const b = await signupOwner(app, 'owner-d@fleet-d.test', 'Fleet D');

    await createMotorcycle(app, a.accessToken, 'KDC-001');
    await listMotorcycles(app, a.accessToken); // warm A's cache: 1 bike
    await listMotorcycles(app, b.accessToken); // warm B's cache: 0 bikes

    // Second create for A must bust A's cache - the next read is not the
    // stale 1-bike snapshot from above.
    await createMotorcycle(app, a.accessToken, 'KDC-002');
    const afterSecondCreate = await listMotorcycles(app, a.accessToken);
    expect(afterSecondCreate.body).toHaveLength(2);

    // B's cache was never touched by A's write.
    const bStillEmpty = await listMotorcycles(app, b.accessToken);
    expect(bStillEmpty.body).toEqual([]);
  });
});
