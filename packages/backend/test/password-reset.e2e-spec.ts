import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PasswordResetChannel, PasswordResetRoute, UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { MailerService, MailMessage } from '../src/modules/notification/mailer.service';
import { requestContext } from '../src/common/context/request-context';
import { hashPassword } from '../src/modules/auth/utils/password.util';
import {
  RESET_CODE_MAX_ATTEMPTS,
  passwordResetKey,
} from '../src/modules/auth/password-reset.constants';
import { cleanDatabase, CLEAN_DATABASE_HOOK_TIMEOUT_MS } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';

/**
 * Stage H0f. Before this stage there was no way to reset a password at all -
 * not for the rider, not for the owner - so a rider who forgot the password
 * his owner typed for him at creation needed someone with database access.
 * These cover the three properties that make the replacement safe rather
 * than merely present: it really does end every existing session, it cannot
 * be used to find out which email addresses are real, and a code cannot be
 * ground down by guessing.
 *
 * Sanctioned placeholder phone numbers only (+2557000000xx) - this repo is
 * public. Phones are unique per tenant, so the same handful is reused across
 * tenants deliberately.
 */

/**
 * These tests are slow on purpose, and the slowness is the security property
 * doing its job. Reset codes are stored bcrypt-hashed at the same cost as a
 * password (~430ms per hash or comparison on CI-class hardware), because a
 * six-digit code behind a fast hash is reversible the moment anyone reads
 * Redis. A single test here can perform ten of those - a signup, a driver
 * creation, a code issue, five wrong guesses and a login - which is comfortably
 * past jest's 5s default.
 *
 * So: raise the timeout, never the hash cost. Lowering the cost to make these
 * finish sooner would trade the one thing protecting a code at rest for a few
 * seconds of test runtime.
 */
const BCRYPT_HEAVY_TIMEOUT_MS = 60_000;

/** Captures what the app tried to send instead of sending it, so a test can
 *  read the code out of the message the rider would have received. */
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
  const match = /Your password reset code is: (\d{6})/.exec(message.text);
  if (!match) throw new Error(`No code in message: ${message.text}`);
  return match[1];
}

describe('Password reset (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let mailer: CapturingMailer;

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

  // -- helpers ---------------------------------------------------------

  let phoneSeed = 0;
  const nextPhone = () => `+25570000000${phoneSeed++ % 10}`;

  async function signupOwner(email: string, company: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email,
        password: 'password123',
        companyName: company,
        firstName: 'Own',
        lastName: 'Er',
        phone: nextPhone(),
      })
      .expect(201);
    return res.body.accessToken as string;
  }

  async function createDriver(token: string, email: string) {
    const res = await request(app.getHttpServer())
      .post('/drivers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Juma',
        lastName: 'Rider',
        phone: nextPhone(),
        email,
        licenseNumber: `LIC-${Math.random().toString(36).slice(2, 8)}`,
        initialPassword: 'initial-password',
      })
      .expect(201);
    return res.body as { id: string };
  }

  const login = (email: string, password: string) =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password });

  const auditsFor = (userId: string) =>
    requestContext.runUnscoped(() =>
      prisma.client.passwordResetAudit.findMany({ where: { userId } }),
    );

  // -- (a) owner-initiated ---------------------------------------------

  describe('owner resets a rider from the dashboard', () => {
    it(
      'replaces the password, revokes every live session, and records who did it',
      async () => {
        const ownerToken = await signupOwner('owner-a@test.local', 'Fleet A');
        const driver = await createDriver(ownerToken, 'rider-a@test.local');

        // Two live sessions, so "revokes every session" means more than one.
        const first = await login('rider-a@test.local', 'initial-password').expect(200);
        const second = await login('rider-a@test.local', 'initial-password').expect(200);

        const res = await request(app.getHttpServer())
          .patch(`/drivers/${driver.id}/password`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ newPassword: 'a-brand-new-password' })
          .expect(200);
        expect(res.body.sessionsRevoked).toBe(2);

        // The old password is gone and the new one works.
        await login('rider-a@test.local', 'initial-password').expect(401);
        await login('rider-a@test.local', 'a-brand-new-password').expect(200);

        // Both refresh tokens are dead - this is the point of the whole
        // exercise. A reset that left a seven-day refresh token alive would
        // leave the intruder exactly the access it was meant to remove.
        for (const session of [first, second]) {
          await request(app.getHttpServer())
            .post('/auth/refresh')
            .send({ refreshToken: session.body.refreshToken })
            .expect(401);
        }

        const user = await requestContext.runUnscoped(() =>
          prisma.client.user.findFirstOrThrow({ where: { email: 'rider-a@test.local' } }),
        );
        const audits = await auditsFor(user.id);
        expect(audits).toHaveLength(1);
        expect(audits[0].route).toBe(PasswordResetRoute.OWNER_DASHBOARD);
        expect(audits[0].channel).toBeNull();
        expect(audits[0].actorUserId).not.toBeNull();
        expect(audits[0].sessionsRevoked).toBe(2);

        // Stage H0f Part 2 - an owner setting a password proves nothing about the
        // rider's email address, so it must NOT count as evidence that he
        // can recover on his own. This is the assertion that keeps the
        // dashboard from telling an owner a comfortable lie.
        expect(user.emailProvenAt).toBeNull();
      },
      BCRYPT_HEAVY_TIMEOUT_MS,
    );

    it(
      'refuses a MANAGER - resetting a rider means being able to pay as him',
      async () => {
        const ownerToken = await signupOwner('owner-m@test.local', 'Fleet M');
        const driver = await createDriver(ownerToken, 'rider-m@test.local');

        const owner = await requestContext.runUnscoped(() =>
          prisma.client.user.findFirstOrThrow({ where: { email: 'owner-m@test.local' } }),
        );
        // No endpoint creates a MANAGER (signup only makes owners), so this
        // one is inserted directly.
        const managerHash = await hashPassword('manager-password');
        await requestContext.runUnscoped(() =>
          prisma.client.user.create({
            data: {
              tenantId: owner.tenantId,
              email: 'manager-m@test.local',
              passwordHash: managerHash,
              firstName: 'Man',
              lastName: 'Ager',
              phone: nextPhone(),
              role: UserRole.MANAGER,
            },
          }),
        );

        const managerLogin = await login('manager-m@test.local', 'manager-password').expect(200);

        await request(app.getHttpServer())
          .patch(`/drivers/${driver.id}/password`)
          .set('Authorization', `Bearer ${managerLogin.body.accessToken}`)
          .send({ newPassword: 'manager-should-not-manage-this' })
          .expect(403);

        // And the rider's original password still works.
        await login('rider-m@test.local', 'initial-password').expect(200);
      },
      BCRYPT_HEAVY_TIMEOUT_MS,
    );

    it(
      "returns 404, never 403, for a driver in someone else's tenant",
      async () => {
        const ownerOne = await signupOwner('owner-x@test.local', 'Fleet X');
        const ownerTwo = await signupOwner('owner-y@test.local', 'Fleet Y');
        const foreignDriver = await createDriver(ownerTwo, 'rider-y@test.local');

        // 403 would confirm the id is real; 404 says nothing either way.
        await request(app.getHttpServer())
          .patch(`/drivers/${foreignDriver.id}/password`)
          .set('Authorization', `Bearer ${ownerOne}`)
          .send({ newPassword: 'not-yours-to-set' })
          .expect(404);

        await login('rider-y@test.local', 'initial-password').expect(200);
      },
      BCRYPT_HEAVY_TIMEOUT_MS,
    );
  });

  // -- (b) self-service by code ----------------------------------------

  describe('rider resets with a code', () => {
    it(
      'answers identically for an unknown address, and sends nothing',
      async () => {
        const ownerToken = await signupOwner('owner-e@test.local', 'Fleet E');
        await createDriver(ownerToken, 'rider-e@test.local');

        const known = await request(app.getHttpServer())
          .post('/auth/password-reset/request')
          .send({ email: 'rider-e@test.local' })
          .expect(202);
        const sentForKnown = mailer.sent.length;

        const unknown = await request(app.getHttpServer())
          .post('/auth/password-reset/request')
          .send({ email: 'nobody-here@test.local' })
          .expect(202);

        // Same status, same body - nothing distinguishes a real account.
        expect(unknown.body).toEqual(known.body);
        expect(sentForKnown).toBe(1);
        expect(mailer.sent).toHaveLength(1); // no second message
      },
      BCRYPT_HEAVY_TIMEOUT_MS,
    );

    it(
      'stores the code hashed with a TTL, then lets it be used exactly once',
      async () => {
        const ownerToken = await signupOwner('owner-c@test.local', 'Fleet C');
        await createDriver(ownerToken, 'rider-c@test.local');

        await request(app.getHttpServer())
          .post('/auth/password-reset/request')
          .send({ email: 'rider-c@test.local' })
          .expect(202);

        const code = codeFrom(mailer.sent[0]);
        const user = await requestContext.runUnscoped(() =>
          prisma.client.user.findFirstOrThrow({ where: { email: 'rider-c@test.local' } }),
        );

        // Never at rest in a readable form, and it expires on its own.
        const stored = await redis.hgetall(passwordResetKey(user.id));
        expect(stored.hash).toBeDefined();
        expect(stored.hash).not.toContain(code);
        expect(await redis.ttl(passwordResetKey(user.id))).toBeGreaterThan(0);

        await request(app.getHttpServer())
          .post('/auth/password-reset/confirm')
          .send({ email: 'rider-c@test.local', code, newPassword: 'code-set-password' })
          .expect(204);

        await login('rider-c@test.local', 'code-set-password').expect(200);
        await login('rider-c@test.local', 'initial-password').expect(401);

        // Single use - replaying the same code is worth nothing.
        await request(app.getHttpServer())
          .post('/auth/password-reset/confirm')
          .send({ email: 'rider-c@test.local', code, newPassword: 'second-go-password' })
          .expect(401);
        await login('rider-c@test.local', 'second-go-password').expect(401);

        const audits = await auditsFor(user.id);
        expect(audits).toHaveLength(1);
        expect(audits[0].route).toBe(PasswordResetRoute.SELF_SERVICE_CODE);
        expect(audits[0].channel).toBe(PasswordResetChannel.EMAIL);
        // Nobody approved this but the rider himself.
        expect(audits[0].actorUserId).toBeNull();

        // Stage H0f Part 2 - he received a code at this address and used it, which
        // is the one thing in the system that proves the address reaches
        // him. The Drivers list reads this to tell his owner whether he can
        // recover without help.
        const after = await requestContext.runUnscoped(() =>
          prisma.client.user.findFirstOrThrow({ where: { email: 'rider-c@test.local' } }),
        );
        expect(after.emailProvenAt).not.toBeNull();
      },
      BCRYPT_HEAVY_TIMEOUT_MS,
    );

    it(
      'destroys the code after a few wrong guesses, without locking the account',
      async () => {
        const ownerToken = await signupOwner('owner-g@test.local', 'Fleet G');
        await createDriver(ownerToken, 'rider-g@test.local');

        await request(app.getHttpServer())
          .post('/auth/password-reset/request')
          .send({ email: 'rider-g@test.local' })
          .expect(202);
        const realCode = codeFrom(mailer.sent[0]);
        const wrongCode = realCode === '000000' ? '111111' : '000000';

        for (let attempt = 0; attempt < RESET_CODE_MAX_ATTEMPTS; attempt += 1) {
          await request(app.getHttpServer())
            .post('/auth/password-reset/confirm')
            .send({ email: 'rider-g@test.local', code: wrongCode, newPassword: 'guessed-password' })
            .expect(401);
        }

        // The budget is spent, so even the real code is now worthless.
        await request(app.getHttpServer())
          .post('/auth/password-reset/confirm')
          .send({ email: 'rider-g@test.local', code: realCode, newPassword: 'too-late-password' })
          .expect(401);

        // The account itself is untouched: the rider can still sign in with
        // what he had, and can still ask for another code.
        await login('rider-g@test.local', 'initial-password').expect(200);
        await request(app.getHttpServer())
          .post('/auth/password-reset/request')
          .send({ email: 'rider-g@test.local' })
          .expect(202);
      },
      BCRYPT_HEAVY_TIMEOUT_MS,
    );
  });
});
