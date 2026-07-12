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
import { AuthenticatedUser, JwtAccessPayload, JwtRefreshPayload } from './auth.types';
import { hashPassword, comparePassword } from './utils/password.util';
import { hashRefreshToken } from './utils/refresh-token.util';
import {
  ACCESS_TOKEN_EXPIRES_IN,
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

  async login(dto: LoginDto): Promise<TokenResponseDto> {
    const matches = await requestContext.runUnscoped(() =>
      this.prisma.client.user.findMany({ where: { email: dto.email } }),
    );

    if (matches.length === 0) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (matches.length > 1) {
      throw new ConflictException('Multiple accounts found for this email - contact support');
    }

    const user = matches[0];
    const valid = await comparePassword(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
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

  async validateToken(payload: JwtAccessPayload): Promise<AuthenticatedUser> {
    const user = await requestContext.runUnscoped(() =>
      this.prisma.client.user.findUnique({ where: { id: payload.sub } }),
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
