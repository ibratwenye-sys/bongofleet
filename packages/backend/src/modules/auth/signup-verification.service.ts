import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { requestContext } from '../../common/context/request-context';
import { MailerService } from '../notification/mailer.service';
import { VerificationCodeService } from '../../common/verification-code/verification-code.service';
import {
  SIGNUP_CODE_LENGTH,
  SIGNUP_CODE_MAX_ATTEMPTS,
  SIGNUP_CODE_TTL_SECONDS,
  signupVerificationKey,
} from './signup-verification.constants';

/**
 * Stage S1 Part 2 - reuses the H0f code core (VerificationCodeService):
 * random code, bcrypt-hashed in Redis, single use, attempt-budgeted. Same
 * mechanics as password reset, different purpose: this activates a tenant
 * instead of resetting a password, and lives under its own key/constants
 * (signup-verification.constants.ts) so the two can change independently.
 */
@Injectable()
export class SignupVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
    private readonly verificationCodes: VerificationCodeService,
  ) {}

  /**
   * Called once, right after signup creates the tenant + owner. Looked up by
   * email rather than passed a tenantId directly: signup's own uniqueness
   * check (AuthService.signup) already guarantees this resolves to exactly
   * the row just created, and it keeps AuthService and SignupVerification
   * decoupled the same way AuthService and PasswordResetService already are.
   */
  async sendCode(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const user = await requestContext.runUnscoped(() =>
      this.prisma.client.user.findFirst({
        where: { email: normalized },
        select: { email: true, firstName: true, tenantId: true },
      }),
    );
    if (!user) {
      return;
    }

    await this.issueAndDeliver(user);
  }

  /**
   * Authenticated - the caller already holds the signup access token (its
   * tenant is locked everywhere except @AllowWhenLocked routes, this one
   * included; see JwtAuthGuard). No email-based lookup or "identical
   * response" dance is needed here the way password reset needs one: the
   * caller has already proven who they are by holding a valid token for this
   * specific tenant, so there is no address to enumerate.
   */
  async resendCode(tenantId: string): Promise<void> {
    const user = await requestContext.runUnscoped(() =>
      this.prisma.client.user.findFirstOrThrow({
        where: { tenantId },
        select: { email: true, firstName: true, tenantId: true },
      }),
    );

    await this.issueAndDeliver(user);
  }

  private async issueAndDeliver(user: {
    email: string;
    firstName: string;
    tenantId: string;
  }): Promise<void> {
    const code = await this.verificationCodes.issue(signupVerificationKey(user.tenantId), {
      length: SIGNUP_CODE_LENGTH,
      ttlSeconds: SIGNUP_CODE_TTL_SECONDS,
    });

    const minutes = Math.round(SIGNUP_CODE_TTL_SECONDS / 60);
    await this.mailer.send({
      to: [user.email],
      subject: 'Verify your BongoFleet account',
      text: [
        `Hello ${user.firstName},`,
        '',
        `Your verification code is: ${code}`,
        '',
        `It expires in ${minutes} minutes and can be used once.`,
      ].join('\n'),
    });
  }

  /**
   * Authenticated too - keyed by the caller's own tenantId, not an email.
   *
   * trialEndsAt is set HERE, not at signup - see checkTenantLock and the
   * migration's grandfather comment for why: an owner who opens the email
   * the next morning must not have already burned part of a 7-day trial on
   * nothing. TENANT_TRIAL_DAYS is a config value (env.validation.ts), not a
   * constant, specifically so it can move without a deploy.
   */
  async confirmCode(tenantId: string, code: string): Promise<void> {
    const ok = await this.verificationCodes.verify(
      signupVerificationKey(tenantId),
      code,
      SIGNUP_CODE_MAX_ATTEMPTS,
    );
    if (!ok) {
      throw new UnauthorizedException('That code is not valid or has expired');
    }

    const trialDays = this.config.get<number>('TENANT_TRIAL_DAYS', 7);
    const trialEndsAt = new Date();
    trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + trialDays);

    await requestContext.runUnscoped(() =>
      this.prisma.client.tenant.update({
        where: { id: tenantId },
        data: {
          status: TenantStatus.ACTIVE,
          verifiedAt: new Date(),
          trialEndsAt,
        },
      }),
    );
  }
}
