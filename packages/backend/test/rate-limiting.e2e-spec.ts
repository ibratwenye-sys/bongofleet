import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanDatabase } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';

/**
 * Stage H0. Real HTTP requests through the real guard pipeline and the real
 * (Redis-backed) storage - the tracker-function and skipIf wiring already
 * has unit coverage (src/common/throttle/*.spec.ts); this file proves the
 * end-to-end behaviour those units compose into actually holds.
 */
describe('Rate limiting (e2e, Stage H0)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seedCounter = 0;

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
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  function signupBody(overrides: Partial<Record<string, string>> = {}) {
    seedCounter += 1;
    return {
      email: `owner-${seedCounter}@rl-test.local`,
      password: 'password123',
      companyName: `Rate Ltd ${seedCounter}`,
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: `+2547${String(10000000 + seedCounter).padStart(8, '0')}`,
      ...overrides,
    };
  }

  async function signup(overrides: Partial<Record<string, string>> = {}) {
    const body = signupBody(overrides);
    const res = await request(app.getHttpServer()).post('/auth/signup').send(body).expect(201);
    return {
      body,
      accessToken: res.body.accessToken as string,
      refreshToken: res.body.refreshToken as string,
    };
  }

  it("Part 1: authenticated requests from two different users on the same IP do not consume each other's budget", async () => {
    const userA = await signup();
    const userB = await signup();

    const a1 = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(200);
    const a2 = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(200);

    // User A's remaining count has dropped across two calls...
    const remainingAfterA1 = Number(a1.headers['x-ratelimit-remaining']);
    const remainingAfterA2 = Number(a2.headers['x-ratelimit-remaining']);
    expect(remainingAfterA2).toBe(remainingAfterA1 - 1);

    // ...but user B's very first call starts from the same fresh ceiling
    // user A's first call did, not wherever A's counter left off.
    const b1 = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .expect(200);
    expect(Number(b1.headers['x-ratelimit-remaining'])).toBe(remainingAfterA1);
  });

  it("Part 2: login attempts against two different identifiers from the same IP do not consume each other's budget", async () => {
    const userA = await signup();
    await signup(); // userB only needs to exist as a distinct identifier below

    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: userA.body.email, password: 'wrong-password' })
        .expect(401);
    }

    // A fresh identifier's first attempt sees a full budget, unaffected by
    // the three attempts already spent against userA's identifier.
    const other = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'never-signed-up@rl-test.local', password: 'whatever' })
      .expect(401);
    expect(Number(other.headers['x-ratelimit-remaining-login-identifier'])).toBe(4); // 5 - 1
  });

  it('Part 2: repeated login attempts against the SAME identifier are still limited (5/min)', async () => {
    const user = await signup();

    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.body.email, password: 'wrong-password' })
        .expect(401);
    }

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.body.email, password: 'wrong-password' })
      .expect(429);
  });

  it('Part 2: the pure-IP login backstop triggers when many identifiers are tried from one host (30/min)', async () => {
    for (let i = 0; i < 30; i += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `backstop-${i}@rl-test.local`, password: 'whatever' })
        .expect(401);
    }

    // Each of these 30 identifiers was only tried once - nowhere near the
    // per-identifier limit of 5 - so only the pure-IP backstop explains a
    // 429 on the 31st, distinct identifier.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'backstop-30@rl-test.local', password: 'whatever' })
      .expect(429);
  }, 30_000);

  it("Part 3: refresh does not consume login's budget", async () => {
    const user = await signup();
    let lastRefreshToken = user.refreshToken;

    // Exhaust login's per-identifier budget with valid credentials (a
    // successful login still counts against it).
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.body.email, password: 'password123' })
        .expect(200);
    }
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.body.email, password: 'password123' })
      .expect(429);

    // Refresh, using the still-valid token from signup, is untouched by the
    // login identifier's exhausted budget.
    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: lastRefreshToken })
      .expect(200);
    lastRefreshToken = refreshRes.body.refreshToken;
    expect(refreshRes.body.accessToken).toBeDefined();
  });

  it("Part 5: signup gets its own identifier-keyed budget (3/min), independent of login's", async () => {
    const email = 'signup-throttle@rl-test.local';
    const body = (suffix: number) => ({
      email,
      password: 'password123',
      companyName: `Co ${suffix}`,
      firstName: 'A',
      lastName: 'B',
      phone: `+25470${String(1000000 + suffix).padStart(7, '0')}`,
    });

    // First succeeds; the tenant now exists, so the next two fail on the
    // duplicate-email business rule (409) - but that still counts against
    // the throttle, since the guard runs before the handler.
    await request(app.getHttpServer()).post('/auth/signup').send(body(1)).expect(201);
    await request(app.getHttpServer()).post('/auth/signup').send(body(2)).expect(409);
    await request(app.getHttpServer()).post('/auth/signup').send(body(3)).expect(409);

    await request(app.getHttpServer()).post('/auth/signup').send(body(4)).expect(429);
  });
});
