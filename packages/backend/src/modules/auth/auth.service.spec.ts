import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { DriverType, Language, Theme, UserRole } from '@prisma/client';
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
        update: jest.Mock;
      };
      driver: {
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
        user: {
          findFirst: jest.fn(),
          findMany: jest.fn(),
          findUnique: jest.fn(),
          update: jest.fn(),
        },
        driver: { findUnique: jest.fn() },
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
    it('creates a Tenant and a User with role OWNER, never a Driver', async () => {
      prisma.client.user.findFirst.mockResolvedValue(null);
      const tenantCreate = jest.fn().mockResolvedValue({ id: 'tenant-1' });
      const userCreate = jest.fn().mockResolvedValue(baseUser);
      const driverCreate = jest.fn();
      prisma.client.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({
          tenant: { create: tenantCreate },
          user: { create: userCreate },
          driver: { create: driverCreate },
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
      expect(driverCreate).not.toHaveBeenCalled();
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
      // Stage H0g - this pre-dates the password-resolution login: it used to
      // pass because the old implementation counted matches straight off
      // findMany's length, never comparing a password at all. Now that
      // ambiguity means "the SAME password verifies against two accounts",
      // the precondition has to be true, or both candidates fail
      // comparePassword against the fake 'hashed' value and this collapses
      // to the unknown-email case (0 matches) instead of the one under test.
      prisma.client.user.findMany.mockResolvedValue([baseUser, { ...baseUser, id: 'user-2' }]);
      jest.spyOn(passwordUtil, 'comparePassword').mockResolvedValue(true);

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

  describe('getDriverType', () => {
    const riderActor = {
      userId: 'user-rider',
      tenantId: 'tenant-1',
      role: UserRole.RIDER,
      email: 'rider@example.com',
      firstName: 'R',
      lastName: 'Ider',
      jti: 'jti-1',
    };

    it('returns RIDER for a rider-mode driver', async () => {
      prisma.client.driver.findUnique.mockResolvedValue({ driverType: DriverType.RIDER });

      await expect(service.getDriverType(riderActor)).resolves.toBe(DriverType.RIDER);
      expect(prisma.client.driver.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-rider' },
        select: { driverType: true },
      });
    });

    it('returns CAR_DRIVER for a car-driver-mode driver', async () => {
      prisma.client.driver.findUnique.mockResolvedValue({ driverType: DriverType.CAR_DRIVER });

      await expect(service.getDriverType(riderActor)).resolves.toBe(DriverType.CAR_DRIVER);
    });

    it('returns TRUCK_DRIVER for a truck-driver-mode driver', async () => {
      prisma.client.driver.findUnique.mockResolvedValue({ driverType: DriverType.TRUCK_DRIVER });

      await expect(service.getDriverType(riderActor)).resolves.toBe(DriverType.TRUCK_DRIVER);
    });

    it('never queries Driver for a non-RIDER role - OWNER/MANAGER/MECHANIC have no Driver row', async () => {
      const ownerActor = { ...riderActor, userId: 'user-owner', role: UserRole.OWNER };

      await expect(service.getDriverType(ownerActor)).resolves.toBeNull();
      expect(prisma.client.driver.findUnique).not.toHaveBeenCalled();
    });

    it('returns null if a RIDER-role user unexpectedly has no Driver row', async () => {
      prisma.client.driver.findUnique.mockResolvedValue(null);

      await expect(service.getDriverType(riderActor)).resolves.toBeNull();
    });
  });

  describe('getTheme / getLanguage / updatePreferences', () => {
    const actor = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: UserRole.OWNER,
      email: 'owner@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      jti: 'jti-1',
    };

    it('getTheme returns the stored theme, or null if never chosen', async () => {
      prisma.client.user.findUnique.mockResolvedValue({ theme: Theme.LIGHT });
      await expect(service.getTheme(actor)).resolves.toBe(Theme.LIGHT);

      prisma.client.user.findUnique.mockResolvedValue({ theme: null });
      await expect(service.getTheme(actor)).resolves.toBeNull();
    });

    it('getLanguage returns the stored language, or null if never chosen', async () => {
      prisma.client.user.findUnique.mockResolvedValue({ language: Language.SW });
      await expect(service.getLanguage(actor)).resolves.toBe(Language.SW);

      prisma.client.user.findUnique.mockResolvedValue({ language: null });
      await expect(service.getLanguage(actor)).resolves.toBeNull();
    });

    it('updatePreferences rejects a body with neither field', async () => {
      await expect(service.updatePreferences(actor, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.client.user.update).not.toHaveBeenCalled();
    });

    it('updatePreferences accepts theme alone, in a single Prisma update call', async () => {
      prisma.client.user.update.mockResolvedValue({ theme: Theme.LIGHT, language: null });

      const result = await service.updatePreferences(actor, { theme: Theme.LIGHT });

      expect(prisma.client.user.update).toHaveBeenCalledTimes(1);
      expect(prisma.client.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { theme: Theme.LIGHT, language: undefined },
        select: { theme: true, language: true },
      });
      expect(result).toEqual({ theme: Theme.LIGHT, language: null });
    });

    it('updatePreferences accepts language alone, in a single Prisma update call', async () => {
      prisma.client.user.update.mockResolvedValue({ theme: null, language: Language.SW });

      const result = await service.updatePreferences(actor, { language: Language.SW });

      expect(prisma.client.user.update).toHaveBeenCalledTimes(1);
      expect(prisma.client.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { theme: undefined, language: Language.SW },
        select: { theme: true, language: true },
      });
      expect(result).toEqual({ theme: null, language: Language.SW });
    });

    it('updatePreferences accepts both fields together, in a single Prisma update call', async () => {
      prisma.client.user.update.mockResolvedValue({ theme: Theme.DARK, language: Language.EN });

      const result = await service.updatePreferences(actor, {
        theme: Theme.DARK,
        language: Language.EN,
      });

      expect(prisma.client.user.update).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ theme: Theme.DARK, language: Language.EN });
    });
  });
});
