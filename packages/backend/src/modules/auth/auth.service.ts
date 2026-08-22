import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { requestContext } from '../../common/context/request-context';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import {
  AuthenticatedUser,
  AuthenticatedUserWithTenantLock,
  JwtAccessPayload,
  JwtRefreshPayload,
} from './auth.types';
import { hashPassword, comparePassword } from './utils/password.util';
import { hashRefreshToken } from './utils/refresh-token.util';
import {
  ACCESS_TOKEN_EXPIRES_IN,
  LOGIN_EMAIL_CANDIDATE_LIMIT,
  REFRESH_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_TTL_SECONDS,
  refreshKey,
} from './auth.constants';

const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 15 * 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async signup(dto: SignupDto): Promise<TokenResponseDto> {
    const existing = await requestContext.runUnscoped(() =>
      this.prisma.client.user.findFirst({ where: { email: dto.email } }),
    );
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await hashPassword(dto.password);

    const { tenant, user } = await requestContext.runUnscoped(() =>
      this.prisma.client.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({ data: { name: dto.companyName } });
        const user = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: dto.email,
            phone: dto.phone,
            passwordHash,
            role: UserRole.OWNER,
            firstName: dto.firstName,
            lastName: dto.lastName,
          },
        });
        return { tenant, user };
      }),
    );

    return this.issueTokenPair({
      userId: user.id,
      tenantId: tenant.id,
      role: user.role,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
  }

  /**
   * Stage H0g. email is unique per tenant, not globally, so this can no
   * longer resolve "the account" from the address alone - it resolves the
   * account the SUPPLIED PASSWORD belongs to, among every user with that
   * address. No tenant selector, no extra field: a rider at a junction is
   * not going to type a fleet code, so the password is the only thing that
   * can disambiguate without asking him something new.
   *
   * isActive is filtered in the query, not checked after: a deactivated
   * account is simply never a candidate, so a login attempt against one
   * fails exactly like an unknown address - matches.length === 0, same
   * UnauthorizedException, same message. That is what "skipped in a way
   * that does not let someone infer the account exists" means in practice;
   * there is no separate deactivated-branch to accidentally answer
   * differently.
   *
   * Bcrypt runs against candidates one at a time and stops as soon as a
   * second match is confirmed - once the answer is "ambiguous", checking a
   * third or fourth candidate cannot change that, and every match beyond
   * the second exists purely to prove the wording, not to change it, so
   * there is nothing to check for. It cannot stop after the FIRST match,
   * though: a single match is only safe to sign into once every other
   * candidate has been ruled out.
   */
  async login(dto: LoginDto): Promise<TokenResponseDto> {
    const candidates = await requestContext.runUnscoped(() =>
      this.prisma.client.user.findMany({
        where: { email: dto.email, isActive: true },
        orderBy: { createdAt: 'asc' },
        take: LOGIN_EMAIL_CANDIDATE_LIMIT,
      }),
    );

    const matches: typeof candidates = [];
    for (const candidate of candidates) {
      if (await comparePassword(dto.password, candidate.passwordHash)) {
        matches.push(candidate);
        if (matches.length > 1) break;
      }
    }

    if (matches.length === 0) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (matches.length > 1) {
      // Deliberately not "contact support" (the pre-Stage-H0g wording): the
      // rider's owner is who can actually resolve this - by resetting one of
      // the colliding passwords - and is who Stage H0f gave a reset path to.
      throw new ConflictException(
        'This email and password match more than one account. Contact your fleet owner to sign in.',
      );
    }

    const user = matches[0];

    return this.issueTokenPair({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
  }

  async refreshToken(rawToken: string): Promise<TokenResponseDto> {
    let payload: JwtRefreshPayload;
    try {
      payload = this.jwt.verify<JwtRefreshPayload>(rawToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }

    const key = refreshKey(payload.sub, payload.jti);
    const storedHash = await this.redis.get(key);
    if (!storedHash || storedHash !== hashRefreshToken(rawToken)) {
      throw new UnauthorizedException('Refresh token invalid or already used');
    }

    await this.redis.del(key);

    const user = await requestContext.runUnscoped(() =>
      this.prisma.client.user.findUnique({ where: { id: payload.sub } }),
    );
    if (!user || !user.isActive || user.tenantId !== payload.tenant_id) {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }

    return this.issueTokenPair({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
  }

  async logout(userId: string, jti: string): Promise<void> {
    await this.redis.del(refreshKey(userId, jti));
  }

  /**
   * Stage S1 - also loads the tenant's lock-relevant fields (status,
   * trialEndsAt, billingExemptAt) and carries them onto AuthenticatedUser.
   * This method deliberately does NOT throw for a locked tenant - it only
   * reports isActive/tenant-match, exactly as before. The lock decision
   * belongs to JwtAuthGuard, which knows which route is being called and can
   * let a handful of routes (@AllowWhenLocked) through anyway; this method
   * has no route context to make that call correctly.
   */
  async validateToken(payload: JwtAccessPayload): Promise<AuthenticatedUserWithTenantLock> {
    const user = await requestContext.runUnscoped(() =>
      this.prisma.client.user.findUnique({
        where: { id: payload.sub },
        include: { tenant: { select: { status: true, trialEndsAt: true, billingExemptAt: true } } },
      }),
    );

    if (!user || user.tenantId !== payload.tenant_id || !user.isActive) {
      throw new UnauthorizedException('Invalid token');
    }

    return {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      jti: payload.jti,
      tenantStatus: user.tenant.status,
      trialEndsAt: user.tenant.trialEndsAt,
      billingExemptAt: user.tenant.billingExemptAt,
    };
  }

  private async issueTokenPair(profile: Omit<AuthenticatedUser, 'jti'>): Promise<TokenResponseDto> {
    const jti = randomUUID();
    const accessPayload: JwtAccessPayload = {
      sub: profile.userId,
      tenant_id: profile.tenantId,
      role: profile.role,
      jti,
    };

    const accessToken = this.jwt.sign(accessPayload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    });

    const refreshPayload: JwtRefreshPayload = accessPayload;
    const refreshToken = this.jwt.sign(refreshPayload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    });

    await this.redis.set(
      refreshKey(profile.userId, jti),
      hashRefreshToken(refreshToken),
      'EX',
      REFRESH_TOKEN_TTL_SECONDS,
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
    };
  }
}
