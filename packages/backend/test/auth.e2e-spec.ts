import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { refreshKey } from '../src/modules/auth/auth.constants';
import { cleanDatabase, CLEAN_DATABASE_HOOK_TIMEOUT_MS } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';

// No verification needed - these are the app's own freshly-issued tokens
// within the test itself; decoding the payload is enough to compute the
// exact Redis key (refreshKey(sub, jti)) the app used for it.
function decodeJwtPayload(token: string): { sub: string; jti: string } {
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
});
