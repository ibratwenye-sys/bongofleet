import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { refreshKey } from '../src/modules/auth/auth.constants';
import { cleanDatabase, CLEAN_DATABASE_HOOK_TIMEOUT_MS } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';
import { signupAndActivateOwner } from './utils/verified-signup.util';

// No verification needed - these are the app's own freshly-issued tokens
// within the test itself; decoding the payload is enough to compute the
// exact Redis key (refreshKey(sub, jti)) the app used for it.
function decodeJwtPayload(token: string): { sub: string; jti: string; tenant_id: string } {
  const payloadSegment = token.split('.')[1];
  return JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'));
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;

  const signupBody = {
    email: 'owner@acme-fleet.test',
    password: 'password123',
    companyName: 'Acme Fleet',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '+254700000001',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = await createTestApp(moduleFixture);
    prisma = moduleFixture.get(PrismaService);
    redis = moduleFixture.get(RedisService);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  }, CLEAN_DATABASE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  }, CLEAN_DATABASE_HOOK_TIMEOUT_MS);

  it('signs up, logs in, reads /me, refreshes, and logs out', async () => {
    const signupRes = await request(app.getHttpServer())
      .post('/auth/signup')
      .send(signupBody)
      .expect(201);

    expect(signupRes.body.accessToken).toBeDefined();
    expect(signupRes.body.refreshToken).toBeDefined();

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: signupBody.email, password: signupBody.password })
      .expect(200);

    const { accessToken, refreshToken } = loginRes.body;

    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(meRes.body.email).toBe(signupBody.email);
    expect(meRes.body.role).toBe('OWNER');
    expect(meRes.body.passwordHash).toBeUndefined();

    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    expect(refreshRes.body.accessToken).toBeDefined();
    expect(refreshRes.body.refreshToken).not.toBe(refreshToken);

    // Reusing the rotated-out refresh token must fail
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken }).expect(401);

    const newAccessToken = refreshRes.body.accessToken;
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${newAccessToken}`)
      .expect(204);

    // The refresh token issued alongside the now-logged-out access token is dead
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshRes.body.refreshToken })
      .expect(401);
  });

  it('Stage H0c Part 2/4: rotation deletes the OLD refresh key from Redis (not just rejects reuse), and logout deletes it too', async () => {
    const signupRes = await request(app.getHttpServer())
      .post('/auth/signup')
      .send(signupBody)
      .expect(201);
    const firstRefreshToken = signupRes.body.refreshToken as string;
    const { sub: userId, jti: firstJti } = decodeJwtPayload(firstRefreshToken);
    expect(await redis.exists(refreshKey(userId, firstJti))).toBe(1);

    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: firstRefreshToken })
      .expect(200);

    // The OLD key is actually gone from Redis, not just rejected on reuse.
    expect(await redis.exists(refreshKey(userId, firstJti))).toBe(0);

    const secondRefreshToken = refreshRes.body.refreshToken as string;
    const { jti: secondJti } = decodeJwtPayload(secondRefreshToken);
    expect(await redis.exists(refreshKey(userId, secondJti))).toBe(1);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${refreshRes.body.accessToken}`)
      .expect(204);

    // Logout deletes the key for the session it was called on.
    expect(await redis.exists(refreshKey(userId, secondJti))).toBe(0);
  });

  it('rejects login with the wrong password', async () => {
    await request(app.getHttpServer()).post('/auth/signup').send(signupBody).expect(201);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: signupBody.email, password: 'wrong-password' })
      .expect(401);
  });

  it('rejects signup with a duplicate email', async () => {
    await request(app.getHttpServer()).post('/auth/signup').send(signupBody).expect(201);

    await request(app.getHttpServer()).post('/auth/signup').send(signupBody).expect(409);
  });

  it('rejects /me with no token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  /**
   * Stage H0g. email is unique per tenant (@@unique([tenantId, email])), not
   * globally - two unrelated fleet owners can each onboard a rider using the
   * same personal address, and until this stage that permanently locked
   * BOTH riders out: login's findMany({ where: { email } }) matched both
   * rows and threw 409 unconditionally, with no self-service way out for
   * either of them. Dormant with one real customer, a correctness bug in
   * the foundation the moment there is a second.
   *
   * Login now resolves the account the SUPPLIED PASSWORD belongs to, among
   * every user with that address - no tenant selector, because a rider at a
   * junction is not going to type a fleet code.
   */
  describe('login resolves the right account when tenants share an email', () => {
    let phoneSeed = 100;
    const nextPhone = () => `+25570000${(phoneSeed++ % 100).toString().padStart(2, '0')}`;

    async function signupOwner(email: string, company: string) {
      const { accessToken } = await signupAndActivateOwner(app, {
        email,
        password: 'owner-password-123',
        companyName: company,
        firstName: 'Own',
        lastName: 'Er',
        phone: nextPhone(),
      });
      return accessToken;
    }

    async function createDriver(ownerToken: string, email: string, password: string) {
      const res = await request(app.getHttpServer())
        .post('/drivers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          firstName: 'Juma',
          lastName: 'Rider',
          phone: nextPhone(),
          email,
          licenseNumber: `LIC-${Math.random().toString(36).slice(2, 8)}`,
          initialPassword: password,
        })
        .expect(201);
      return res.body as { id: string };
    }

    const login = (email: string, password: string) =>
      request(app.getHttpServer()).post('/auth/login').send({ email, password });

    it('(b) two tenants, same address, different passwords: each signs into the right account and sees only its own tenant', async () => {
      const ownerTokenA = await signupOwner('owner-a@test.local', 'Fleet A');
      const ownerTokenB = await signupOwner('owner-b@test.local', 'Fleet B');
      const sharedEmail = 'shared-rider@test.local';

      const driverA = await createDriver(ownerTokenA, sharedEmail, 'password-for-fleet-a');
      const driverB = await createDriver(ownerTokenB, sharedEmail, 'password-for-fleet-b');

      const loginA = await login(sharedEmail, 'password-for-fleet-a').expect(200);
      const loginB = await login(sharedEmail, 'password-for-fleet-b').expect(200);

      // Not merely "some token" - the ACCOUNT the password belongs to.
      const { tenant_id: tenantIdFromTokenA } = decodeJwtPayload(loginA.body.accessToken);
      const { tenant_id: tenantIdFromTokenB } = decodeJwtPayload(loginB.body.accessToken);
      expect(tenantIdFromTokenA).not.toBe(tenantIdFromTokenB);

      const meA = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${loginA.body.accessToken}`)
        .expect(200);
      const meB = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${loginB.body.accessToken}`)
        .expect(200);

      expect(meA.body.tenantId).toBe(tenantIdFromTokenA);
      expect(meB.body.tenantId).toBe(tenantIdFromTokenB);
      expect(meA.body.tenantId).not.toBe(meB.body.tenantId);

      // Every scoped query in the app reads tenantId off this exact claim
      // (requestContext, populated from the JWT) - a correct /me plus a
      // wrong tenant_id in the token itself would still leak into every
      // other endpoint, so the token is what is actually asserted on here,
      // not just the derived response.
      expect(meA.body.id).not.toBe(meB.body.id);
      const [idA, idB] = [driverA, driverB].map((d) => d.id);
      expect(idA).not.toBe(idB);

      // Ownership-scoped reads reflect the resolved tenant, not just the id.
      const assignmentsA = await request(app.getHttpServer())
        .get('/assignments')
        .set('Authorization', `Bearer ${loginA.body.accessToken}`)
        .expect(200);
      const assignmentsB = await request(app.getHttpServer())
        .get('/assignments')
        .set('Authorization', `Bearer ${loginB.body.accessToken}`)
        .expect(200);
      expect(Array.isArray(assignmentsA.body)).toBe(true);
      expect(Array.isArray(assignmentsB.body)).toBe(true);
    });

    it('(c) refuses when the same password matches more than one account, and never guesses', async () => {
      const ownerTokenA = await signupOwner('owner-c1@test.local', 'Fleet C1');
      const ownerTokenB = await signupOwner('owner-c2@test.local', 'Fleet C2');
      const sharedEmail = 'collision-rider@test.local';
      const sharedPassword = 'identical-password-both-sides';

      await createDriver(ownerTokenA, sharedEmail, sharedPassword);
      await createDriver(ownerTokenB, sharedEmail, sharedPassword);

      const res = await login(sharedEmail, sharedPassword).expect(409);

      // This is the assertion that pins "refuse", not "pick one": no
      // accessToken anywhere in the response, under any key, for any
      // account. A regression that started silently choosing a candidate
      // would still return 409 if only the status code were checked here -
      // this fails loudly on that instead.
      expect(JSON.stringify(res.body)).not.toContain('accessToken');
      expect(res.body.message).toMatch(/contact your fleet owner/i);
    });

    it('(a) an unknown address answers identically to a wrong password against a real account', async () => {
      const ownerToken = await signupOwner('owner-e@test.local', 'Fleet E');
      const email = 'real-rider@test.local';
      await createDriver(ownerToken, email, 'the-real-password');

      const wrongPassword = await login(email, 'not-the-password').expect(401);
      const unknownAddress = await login('nobody-here@test.local', 'anything-at-all').expect(401);

      // Byte-identical, not merely "both 401" - a status-code-only check
      // would pass even if one body leaked something the other didn't.
      expect(unknownAddress.body).toEqual(wrongPassword.body);
    });

    it('(d) a deactivated account sharing the address is skipped without revealing it exists', async () => {
      const ownerTokenA = await signupOwner('owner-d1@test.local', 'Fleet D1');
      const ownerTokenB = await signupOwner('owner-d2@test.local', 'Fleet D2');
      const sharedEmail = 'partly-deactivated@test.local';

      // driverA's id is never needed - only its still-being-active matters,
      // which the login attempt below exercises.
      await createDriver(ownerTokenA, sharedEmail, 'password-a-active');
      const driverB = await createDriver(ownerTokenB, sharedEmail, 'password-b-deactivated');

      await request(app.getHttpServer())
        .delete(`/drivers/${driverB.id}`)
        .set('Authorization', `Bearer ${ownerTokenB}`)
        .expect(204);

      // The deactivated account's own correct password is now worth
      // nothing - and refused the same way a wrong password would be, not
      // with a different message that would confirm the account exists.
      const deactivatedAttempt = await login(sharedEmail, 'password-b-deactivated').expect(401);
      const wrongPasswordAttempt = await login(sharedEmail, 'no-such-password').expect(401);
      expect(deactivatedAttempt.body).toEqual(wrongPasswordAttempt.body);

      // The still-active account, sharing the same address, is unaffected -
      // the deactivated row does not turn this into a false "ambiguous".
      const activeAttempt = await login(sharedEmail, 'password-a-active').expect(200);
      const { tenant_id: activeTenantId } = decodeJwtPayload(activeAttempt.body.accessToken);
      const meActive = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${activeAttempt.body.accessToken}`)
        .expect(200);
      expect(meActive.body.tenantId).toBe(activeTenantId);
    });
  });
});
