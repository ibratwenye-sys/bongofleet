import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PasswordResetChannel, PasswordResetRoute, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { MailerService } from '../notification/mailer.service';
import { requestContext } from '../../common/context/request-context';
import { deleteKeysByPrefix } from '../../redis/redis-key-sweep.util';
import { VerificationCodeService } from '../../common/verification-code/verification-code.service';
import { AuthenticatedUser } from './auth.types';
import { hashPassword } from './utils/password.util';
import {
  RESET_CODE_LENGTH,
  RESET_CODE_MAX_ATTEMPTS,
  RESET_CODE_TTL_SECONDS,
  passwordResetKey,
  userRefreshKeyPrefix,
} from './password-reset.constants';

/**
 * Stage H0f - every way a password gets reset ends here.
 *
 * Before this existed there was no way at all: no reset endpoint, no
 * change-password anywhere, and `initialPassword` accepted only at driver
 * creation. A rider who forgot the password his owner typed for him needed
 * someone with database access. With refresh tokens expiring after seven
 * days, that was not an edge case - it was every rider who spent a week away
 * from the app.
 *
 * The three entry points (owner-initiated, self-service by email, and SMS
 * once a sender ID is approved) differ only in how they establish that the
 * request is legitimate. Once established they all call `applyReset`, which
 * is the only code in the app that writes a password hash after signup. That
 * matters because a reset is three things that must not come apart:
 *
 *   1. set the new hash;
 *   2. destroy EVERY refresh token the user holds - a reset exists to end
 *      someone else's access, and leaving a week-long refresh token alive
 *      would leave them exactly the access you meant to take away;
 *   3. record who did it and by which route.
 *
 * Steps 1 and 3 share a transaction, so a password can never change without
 * the audit row. Step 2 is Redis and cannot join that transaction - see the
 * ordering note in applyReset for why it runs where it does.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mailer: MailerService,
    private readonly verificationCodes: VerificationCodeService,
  ) {}

  // ---------------------------------------------------------------------
  // The core. Everything below funnels into this.
  // ---------------------------------------------------------------------

  private async applyReset(params: {
    userId: string;
    tenantId: string;
    newPassword: string;
    route: PasswordResetRoute;
    channel: PasswordResetChannel | null;
    actorUserId: string | null;
    /** Stage H0f Part 2 - stamps User.emailProvenAt. True only when the reset was
     *  completed with a code sent to that address: the rider read it and
     *  used it, which proves the address reaches him and that he holds it.
     *  An owner-set password proves nothing about the address, so that route
     *  passes false and the field stays as it was. */
    provesEmail?: boolean;
  }): Promise<{ sessionsRevoked: number }> {
    const passwordHash = await hashPassword(params.newPassword);

    // Sessions die first, and deliberately so. If this succeeded and the
    // write below then failed, the user would be signed out of a password
    // that still works - annoying, and they can log back in. The other order
    // fails the other way: a changed password with live sessions still
    // attached to it, which is the failure this whole flow exists to
    // prevent. Prefer the recoverable inconsistency to the dangerous one.
    const revokedKeys = await deleteKeysByPrefix(this.redis, userRefreshKeyPrefix(params.userId));
    const sessionsRevoked = revokedKeys.length;

    await requestContext.runUnscoped(() =>
      this.prisma.client.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: params.userId },
          data: {
            passwordHash,
            // Only ever set forward, never cleared: it records that the
            // address reached him once, at a moment that actually happened.
            ...(params.provesEmail ? { emailProvenAt: new Date() } : {}),
          },
        });
        await tx.passwordResetAudit.create({
          data: {
            tenantId: params.tenantId,
            userId: params.userId,
            actorUserId: params.actorUserId,
            route: params.route,
            channel: params.channel,
            sessionsRevoked,
          },
        });
      }),
    );

    return { sessionsRevoked };
  }

  // ---------------------------------------------------------------------
  // (a) Owner resets a rider from the dashboard.
  // ---------------------------------------------------------------------

  /**
   * OWNER only - not MANAGER. Whoever can set a rider's password can sign in
   * as that rider and record payments as him, and this product exists to
   * reduce exactly that kind of fraud; the capability therefore sits with
   * the person who carries the loss. Widening it to MANAGER later is one
   * value in the @Roles list on the controller, and this comment is here so
   * that stays a decision rather than a default.
   *
   * The caller's tenant scoping does the rest: a driver id belonging to
   * another tenant simply is not found, so a stranger's id returns 404 and
   * never 403 - a 403 would confirm the id exists.
   */
  async resetDriverPasswordAsOwner(
    driverId: string,
    newPassword: string,
    actor: AuthenticatedUser,
  ): Promise<{ sessionsRevoked: number }> {
    // Tenant-scoped client: a driver in another tenant returns null here and
    // becomes a 404 below.
    const driver = await this.prisma.client.driver.findUnique({
      where: { id: driverId },
      select: { id: true, tenantId: true, user: { select: { id: true, role: true } } },
    });
    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    // Belt and braces: this endpoint hangs off the driver resource, so the
    // account behind it should always be a RIDER. If a data fix ever pointed
    // a driver row at a staff account, this would otherwise become a way for
    // an owner to take over a colleague's login.
    if (driver.user.role !== UserRole.RIDER) {
      throw new NotFoundException('Driver not found');
    }

    return this.applyReset({
      userId: driver.user.id,
      tenantId: driver.tenantId,
      newPassword,
      route: PasswordResetRoute.OWNER_DASHBOARD,
      channel: null,
      actorUserId: actor.userId,
    });
  }

  // ---------------------------------------------------------------------
  // (b) Self-service: request a code, then use it.
  // ---------------------------------------------------------------------

  /**
   * Always resolves the same way, whether or not the address belongs to
   * anyone. An endpoint that 404s on unknown addresses is an account
   * enumerator: point it at a list and it sorts real customers from
   * strangers for free. The caller cannot tell the difference, so neither
   * can an attacker.
   *
   * Unauthenticated by necessity - the whole point is that the user cannot
   * log in - so the throttlers in throttler-options.factory.ts are the only
   * thing between this and a mail bomb. See PASSWORD_RESET_IDENTIFIER_THROTTLE.
   */
  async requestReset(email: string, channel: PasswordResetChannel): Promise<void> {
    const normalized = email.trim().toLowerCase();

    // Unscoped: nobody is authenticated here, so there is no tenant context
    // to scope by. findMany, not findFirst - email is unique per tenant, not
    // globally, so one address can legitimately belong to a user in each of
    // several tenants and each of them is entitled to a code.
    const users = await requestContext.runUnscoped(() =>
      this.prisma.client.user.findMany({
        where: { email: normalized, isActive: true },
        select: { id: true, email: true, phone: true, firstName: true, tenantId: true },
      }),
    );

    for (const user of users) {
      // Stored hashed, with the attempt counter alongside it, under a TTL so
      // an unused code expires on its own rather than waiting for someone to
      // clean it up. bcrypt rather than the sha256 used for refresh tokens:
      // a six-digit code has only a million possible values, and a fast hash
      // of one is reversible in the time it takes to read this sentence if
      // the Redis contents ever leak.
      const code = await this.verificationCodes.issue(passwordResetKey(user.id), {
        length: RESET_CODE_LENGTH,
        ttlSeconds: RESET_CODE_TTL_SECONDS,
      });

      await this.deliverCode(user, code, channel);
    }
  }

  /**
   * Consumes a code and applies the reset. Returns nothing useful on
   * purpose - the caller logs in normally afterwards.
   *
   * A wrong code is indistinguishable from an unknown address here, for the
   * same reason as above.
   */
  async confirmReset(email: string, code: string, newPassword: string): Promise<void> {
    const normalized = email.trim().toLowerCase();

    const users = await requestContext.runUnscoped(() =>
      this.prisma.client.user.findMany({
        where: { email: normalized, isActive: true },
        select: { id: true, tenantId: true },
      }),
    );

    for (const user of users) {
      const ok = await this.verificationCodes.verify(
        passwordResetKey(user.id),
        code,
        RESET_CODE_MAX_ATTEMPTS,
      );
      if (!ok) continue;

      await this.applyReset({
        userId: user.id,
        tenantId: user.tenantId,
        newPassword,
        route: PasswordResetRoute.SELF_SERVICE_CODE,
        channel: PasswordResetChannel.EMAIL,
        // No actor: the user is the actor, and naming them here would imply
        // an approval by someone else that never happened.
        actorUserId: null,
        // He read a code that was emailed to this address and used it before
        // it expired. That is the only evidence in the system that the
        // address is really his.
        provesEmail: true,
      });
      return;
    }

    throw new UnauthorizedException('That code is not valid or has expired');
  }

  // ---------------------------------------------------------------------
  // Delivery. One code, one message, one sender per channel.
  // ---------------------------------------------------------------------

  /**
   * (c) SMS is not built. The seam is here rather than in the flow above:
   * everything up to this point - lookup, code generation, hashing, TTL,
   * attempt budget, single use, the identical response - is channel-neutral
   * and stays exactly as it is. Adding SMS means implementing the branch
   * below against a sender and nothing else.
   */
  private async deliverCode(
    user: { email: string; phone: string | null; firstName: string },
    code: string,
    channel: PasswordResetChannel,
  ): Promise<void> {
    if (channel === PasswordResetChannel.SMS) {
      // Not reachable today - the DTO does not accept SMS, so this cannot be
      // requested. Left explicit rather than absent so the missing half is
      // visible in the code that would own it.
      this.logger.warn('SMS delivery requested but no SMS sender is configured - nothing sent.');
      return;
    }

    const minutes = Math.round(RESET_CODE_TTL_SECONDS / 60);
    await this.mailer.send({
      to: [user.email],
      subject: 'Your BongoFleet password reset code',
      text: [
        `Hello ${user.firstName},`,
        '',
        `Your password reset code is: ${code}`,
        '',
        `It expires in ${minutes} minutes and can be used once.`,
        '',
        'If you did not ask to reset your password, you can ignore this',
        'message - nothing has changed on your account.',
      ].join('\n'),
    });
  }
}
