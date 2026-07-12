import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import * as passwordUtil from './utils/password.util';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    client: {
      user: {
        findFirst: jest.Mock;
        findMany: jest.Mock;
        findUnique: jest.Mock;
      };
      $transaction: jest.Mock;
    };
  };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let jwt: { sign: jest.Mock; verify: jest.Mock };

  const baseUser = {
    id: 'user-1',
    tenantId: 'tenant-1',
    email: 'owner@example.com',
    passwordHash: 'hashed',
    role: UserRole.OWNER,
    firstName: 'Ada',
    lastName: 'Lovelace',
    isActive: true,
  };

  beforeEach(async () => {
    prisma = {
      client: {
        user: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
        $transaction: jest.fn(),
      },
    };
    redis = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token'), verify: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => `config-${key}`) },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('signup', () => {
    it('creates a Tenant and a User with role OWNER, never a Rider', async () => {
      prisma.client.user.findFirst.mockResolvedValue(null);
      const tenantCreate = jest.fn().mockResolvedValue({ id: 'tenant-1' });
      const userCreate = jest.fn().mockResolvedValue(baseUser);
      const riderCreate = jest.fn();
      prisma.client.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({
          tenant: { create: tenantCreate },
          user: { create: userCreate },
          rider: { create: riderCreate },
        }),
      );
      jest.spyOn(passwordUtil, 'hashPassword').mockResolvedValue('hashed');

      const result = await service.signup({
        email: 'owner@example.com',
        password: 'password123',
        companyName: 'Acme Fleet',
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '+254700000000',
      });

      expect(tenantCreate).toHaveBeenCalledWith({ data: { name: 'Acme Fleet' } });
      expect(userCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: UserRole.OWNER }) }),
      );
      expect(riderCreate).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(redis.set).toHaveBeenCalled();
    });

    it('rejects signup when the email is already registered', async () => {
      prisma.client.user.findFirst.mockResolvedValue(baseUser);

      await expect(
        service.signup({
          email: 'owner@example.com',
          password: 'password123',
          companyName: 'Acme Fleet',
          firstName: 'Ada',
          lastName: 'Lovelace',
          phone: '+254700000000',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    it('rejects an unknown email', async () => {
      prisma.client.user.findMany.mockResolvedValue([]);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'password123' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a wrong password', async () => {
      prisma.client.user.findMany.mockResolvedValue([baseUser]);
      jest.spyOn(passwordUtil, 'comparePassword').mockResolvedValue(false);

      await expect(
        service.login({ email: baseUser.email, password: 'wrong-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an ambiguous cross-tenant email match instead of guessing', async () => {
      prisma.client.user.findMany.mockResolvedValue([baseUser, { ...baseUser, id: 'user-2' }]);

      await expect(
        service.login({ email: baseUser.email, password: 'password123' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('issues a token pair on valid credentials', async () => {
      prisma.client.user.findMany.mockResolvedValue([baseUser]);
      jest.spyOn(passwordUtil, 'comparePassword').mockResolvedValue(true);

      const result = await service.login({ email: baseUser.email, password: 'password123' });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toBe('signed.jwt.token');
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('refresh:user-1:'),
        expect.any(String),
        'EX',
        expect.any(Number),
      );
    });
  });

  describe('refreshToken', () => {
    const payload = { sub: 'user-1', tenant_id: 'tenant-1', role: UserRole.OWNER, jti: 'jti-1' };

    it('rotates a valid, unused refresh token', async () => {
      jwt.verify.mockReturnValue(payload);
      redis.get.mockResolvedValue(createHash('sha256').update('signed.jwt.token').digest('hex'));
      prisma.client.user.findUnique.mockResolvedValue(baseUser);

      const result = await service.refreshToken('signed.jwt.token');

      expect(redis.del).toHaveBeenCalledWith('refresh:user-1:jti-1');
      expect(result.accessToken).toBe('signed.jwt.token');
    });

    it('rejects a refresh token reused after rotation', async () => {
      jwt.verify.mockReturnValue(payload);
      redis.get.mockResolvedValue(null); // already deleted by a prior rotation

      await expect(service.refreshToken('signed.jwt.token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('rejects an expired/invalid-signature refresh token', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.refreshToken('garbage')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
