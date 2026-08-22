import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { TenantStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { MailerService, MailMessage } from '../src/modules/notification/mailer.service';
import { requestContext } from '../src/common/context/request-context';
import {
  SIGNUP_CODE_MAX_ATTEMPTS,
  signupVerificationKey,
} from '../src/modules/auth/signup-verification.constants';
import { cleanDatabase, CLEAN_DATABASE_HOOK_TIMEOUT_MS } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';
import { signupAndActivateOwner } from './utils/verified-signup.util';

/**
 * Stage S1 Parts 1-3. The real verification-code flow, tested end to end
 * exactly once, with the real Redis-backed code and a captured mailer
 * message - every OTHER spec that needs a working owner account uses
 * signupAndActivateOwner (verified-signup.util.ts) instead, which activates
 * a tenant directly via Prisma without running any of this.
 *
 * Bcrypt-heavy, same as password-reset.e2e-spec.ts - codes are hashed at the
 * same cost as a password, so a test performing several issues/verifies is
 * comfortably past jest's 5s default. Raise the timeout, never the hash
 * cost.
 */
const BCRYPT_HEAVY_TIMEOUT_MS = 60_000;

class CapturingMailer {
  readonly sent: MailMessage[] = [];
  get isConfigured(): boolean {
    return true;
  }
  send(message: MailMessage): Promise<boolean> {
    this.sent.push(message);
    return Promise.resolve(true);
  }
}

function codeFrom(message: MailMessage): string {
  const match = /Your verification code is: (\d{6})/.exec(message.text);
  if (!match) throw new Error(`No code in message: ${message.text}`);
  return match[1];
}

describe('Signup verification and tenant lock (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let mailer: CapturingMailer;

  let phoneSeed = 0;
  const nextPhone = () => `+25570000010${phoneSeed++ % 10}`;

  function signupBody(overrides: Partial<Record<string, string>> = {}) {
    return {
      email: 'owner@fresh-fleet.test',
      password: 'password123',
      companyName: 'Fresh Fleet',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: nextPhone(),
      ...overrides,
    };
  }

  beforeAll(async () => {
    mailer = new CapturingMailer();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailerService)
      .useValue(mailer)
      .compile();

    app = await createTestApp(moduleFixture);
    prisma = moduleFixture.get(PrismaService);
    redis = moduleFixture.get(RedisService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    mailer.sent.length = 0;
    await cleanDatabase(prisma);
  }, CLEAN_DATABASE_HOOK_TIMEOUT_MS);

  const tenantRow = (tenantId: string) =>
    requestContext.runUnscoped(() =>
      prisma.client.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    );

  describe('a PENDING_VERIFICATION tenant', () => {
    it(
      'is refused on a business route, but /auth/me, /auth/logout, verify and resend-code all still work',
      async () => {
        const body = signupBody();
        const signupRes = await request(app.getHttpServer())
          .post('/auth/signup')
          .send(body)
          .expect(201);
        const token = signupRes.body.accessToken as string;

        const blocked = await request(app.getHttpServer())
          .get('/drivers')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
        // Clear, not a generic 403 - names the actual problem.
        expect(blocked.body.message).toMatch(/verify your email/i);

        const me = await request(app.getHttpServer())
          .get('/auth/me')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
        expect(me.body.tenantStatus).toBe(TenantStatus.PENDING_VERIFICATION);

        await request(app.getHttpServer())
          .post('/auth/signup/resend-code')
          .set('Authorization', `Bearer ${token}`)
          .expect(204);

        await request(app.getHttpServer())
          .post('/auth/logout')
          .set('Authorization', `Bearer ${token}`)
          .expect(204);
      },
      BCRYPT_HEAVY_TIMEOUT_MS,
    );

    it(
      'a wrong code does not activate the tenant; the attempt budget kills the CODE, not the tenant',
      async () => {
        const body = signupBody({ email: 'owner-wrong-code@fresh-fleet.test' });
        const signupRes = await request(app.getHttpServer())
          .post('/auth/signup')
          .send(body)
          .expect(201);
        const token = signupRes.body.accessToken as string;
        const realCode = codeFrom(mailer.sent[0]);
        const wrongCode = realCode === '000000' ? '111111' : '000000';

        await request(app.getHttpServer())
          .post('/auth/signup/verify')
          .set('Authorization', `Bearer ${token}`)
          .send({ code: wrongCode })
          .expect(401);

        const stillPending = await requestContext.runUnscoped(() =>
          prisma.client.user
            .findFirstOrThrow({ where: { email: body.email }, select: { tenantId: true } })
            .then((u) => tenantRow(u.tenantId)),
        );
        expect(stillPending.status).toBe(TenantStatus.PENDING_VERIFICATION);

        // Spend the rest of the budget with more wrong guesses.
        for (let attempt = 1; attempt < SIGNUP_CODE_MAX_ATTEMPTS; attempt += 1) {
          await request(app.getHttpServer())
            .post('/auth/signup/verify')
            .set('Authorization', `Bearer ${token}`)
            .send({ code: wrongCode })
            .expect(401);
        }

        // Budget is spent - even the REAL code is worthless now. The tenant
        // itself is untouched; a fresh code via resend-code is still the way
        // out, not a locked-out account.
        await request(app.getHttpServer())
          .post('/auth/signup/verify')
          .set('Authorization', `Bearer ${token}`)
          .send({ code: realCode })
          .expect(401);

        await request(app.getHttpServer())
          .post('/auth/signup/resend-code')
          .set('Authorization', `Bearer ${token}`)
          .expect(204);
      },
      BCRYPT_HEAVY_TIMEOUT_MS,
    );
  });

  describe('verifying with the right code', () => {
    it(
      'activates the tenant, stamps verifiedAt, sets trialEndsAt from THIS moment (not signup), and unlocks business routes',
      async () => {
        const body = signupBody({ email: 'owner-verifies@fresh-fleet.test' });
        const signupTime = new Date();
        const signupRes = await request(app.getHttpServer())
          .post('/auth/signup')
          .send(body)
          .expect(201);
        const token = signupRes.body.accessToken as string;
        const code = codeFrom(mailer.sent[0]);

        // Still locked before verifying.
        await request(app.getHttpServer())
          .get('/drivers')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);

        const beforeVerify = new Date();
        await request(app.getHttpServer())
          .post('/auth/signup/verify')
          .set('Authorization', `Bearer ${token}`)
          .send({ code })
          .expect(204);
        const afterVerify = new Date();

        const user = await requestContext.runUnscoped(() =>
          prisma.client.user.findFirstOrThrow({
            where: { email: body.email },
            select: { tenantId: true },
          }),
        );
        const tenant = await tenantRow(user.tenantId);

        expect(tenant.status).toBe(TenantStatus.ACTIVE);
        expect(tenant.verifiedAt).not.toBeNull();
        expect(tenant.trialEndsAt).not.toBeNull();

        // Anchored to verification time: within the window this test's own
        // HTTP round trip took, seven days out.
        const expectedFloor = beforeVerify.getTime() + 7 * 24 * 60 * 60 * 1000 - 2000;
        const expectedCeiling = afterVerify.getTime() + 7 * 24 * 60 * 60 * 1000 + 2000;
        expect(tenant.trialEndsAt!.getTime()).toBeGreaterThanOrEqual(expectedFloor);
        expect(tenant.trialEndsAt!.getTime()).toBeLessThanOrEqual(expectedCeiling);

        // NOT anchored to signup time: bcrypt-hashing the signup password,
        // issuing the code, and hashing it again before verifying all cost
        // real time, so verification happens measurably after signup - and
        // trialEndsAt reflects that gap rather than sitting at exactly
        // signupTime + 7 days. An owner who opens his email later must not
        // have already burned part of the trial on nothing.
        const sevenDaysFromSignup = signupTime.getTime() + 7 * 24 * 60 * 60 * 1000;
        expect(tenant.trialEndsAt!.getTime()).toBeGreaterThan(sevenDaysFromSignup);

        // Now unlocked.
        await request(app.getHttpServer())
          .get('/drivers')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      },
      BCRYPT_HEAVY_TIMEOUT_MS,
    );

    it(
      'is single use - the same code cannot verify twice',
      async () => {
        const body = signupBody({ email: 'owner-single-use@fresh-fleet.test' });
        const signupRes = await request(app.getHttpServer())
          .post('/auth/signup')
          .send(body)
          .expect(201);
        const token = signupRes.body.accessToken as string;
        const code = codeFrom(mailer.sent[0]);

        await request(app.getHttpServer())
          .post('/auth/signup/verify')
          .set('Authorization', `Bearer ${token}`)
          .send({ code })
          .expect(204);

        await request(app.getHttpServer())
          .post('/auth/signup/verify')
          .set('Authorization', `Bearer ${token}`)
          .send({ code })
          .expect(401);
      },
      BCRYPT_HEAVY_TIMEOUT_MS,
    );
  });

  describe('trial expiry and billing exemption (the same guard, exercised directly)', () => {
    it(
      'an expired trial locks a business route through the API - the one code path the dashboard and the rider app both go through',
      async () => {
        const owner = await signupAndActivateOwner(
          app,
          signupBody({ email: 'owner-trial-expired@fresh-fleet.test' }),
        );
        await requestContext.runUnscoped(() =>
          prisma.client.tenant.update({
            where: { id: owner.tenantId },
            data: { trialEndsAt: new Date(Date.now() - 60_000) },
          }),
        );

        const res = await request(app.getHttpServer())
          .get('/drivers')
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .expect(403);
        expect(res.body.message).toMatch(/trial has ended/i);

        // The way out stays reachable.
        await request(app.getHttpServer())
          .get('/auth/me')
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .expect(200);
      },
      BCRYPT_HEAVY_TIMEOUT_MS,
    );

    it(
      'a billing-exempt tenant is never locked, even PAST_DUE with a trial date in the past',
      async () => {
        const owner = await signupAndActivateOwner(
          app,
          signupBody({ email: 'owner-exempt@fresh-fleet.test' }),
        );
        await requestContext.runUnscoped(() =>
          prisma.client.tenant.update({
            where: { id: owner.tenantId },
            data: {
              status: TenantStatus.PAST_DUE,
              trialEndsAt: new Date(Date.now() - 60_000),
              billingExemptAt: new Date(),
            },
          }),
        );

        await request(app.getHttpServer())
          .get('/drivers')
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .expect(200);
      },
      BCRYPT_HEAVY_TIMEOUT_MS,
    );
  });

  describe('resend-code', () => {
    it(
      'invalidates the old code and issues a new one that works',
      async () => {
        const body = signupBody({ email: 'owner-resend@fresh-fleet.test' });
        const signupRes = await request(app.getHttpServer())
          .post('/auth/signup')
          .send(body)
          .expect(201);
        const token = signupRes.body.accessToken as string;
        const staleCode = codeFrom(mailer.sent[0]);

        await request(app.getHttpServer())
          .post('/auth/signup/resend-code')
          .set('Authorization', `Bearer ${token}`)
          .expect(204);
        expect(mailer.sent).toHaveLength(2);
        const freshCode = codeFrom(mailer.sent[1]);

        await request(app.getHttpServer())
          .post('/auth/signup/verify')
          .set('Authorization', `Bearer ${token}`)
          .send({ code: staleCode })
          .expect(401);

        await request(app.getHttpServer())
          .post('/auth/signup/verify')
          .set('Authorization', `Bearer ${token}`)
          .send({ code: freshCode })
          .expect(204);
      },
      BCRYPT_HEAVY_TIMEOUT_MS,
    );
  });

  // Sanity check on the Redis side, mirroring password-reset.e2e-spec.ts's
  // equivalent assertion: the code is never stored in a readable form.
  it(
    'stores the signup code hashed with a TTL, not in plaintext',
    async () => {
      const body = signupBody({ email: 'owner-hash-check@fresh-fleet.test' });
      const signupRes = await request(app.getHttpServer())
        .post('/auth/signup')
        .send(body)
        .expect(201);
      const code = codeFrom(mailer.sent[0]);

      const user = await requestContext.runUnscoped(() =>
        prisma.client.user.findFirstOrThrow({
          where: { email: body.email },
          select: { tenantId: true },
        }),
      );
      const key = signupVerificationKey(user.tenantId);
      const stored = await redis.hgetall(key);
      expect(stored.hash).toBeDefined();
      expect(stored.hash).not.toContain(code);
      expect(await redis.ttl(key)).toBeGreaterThan(0);
      void signupRes;
    },
    BCRYPT_HEAVY_TIMEOUT_MS,
  );
});
