import { Test } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DriverType, UserRole } from '@prisma/client';
import { DriverService } from './driver.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantCacheService } from '../../cache/tenant-cache.service';
import { AuthenticatedUser } from '../auth/auth.types';
import * as passwordUtil from '../auth/utils/password.util';

describe('DriverService', () => {
  let service: DriverService;
  let prisma: {
    client: {
      user: { findFirst: jest.Mock };
      driver: { findFirst: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
      dailyAssignment: { findMany: jest.Mock };
      ownershipPlan: { findMany: jest.Mock };
      motorcycle: { findMany: jest.Mock };
      $transaction: jest.Mock;
    };
  };

  const owner: AuthenticatedUser = {
    userId: 'user-owner',
    tenantId: 'tenant-1',
    role: UserRole.OWNER,
    email: 'owner@example.com',
    firstName: 'O',
    lastName: 'Wner',
    jti: 'jti-owner',
  };

  const driverActor: AuthenticatedUser = {
    userId: 'user-driver',
    tenantId: 'tenant-1',
    role: UserRole.RIDER,
    email: 'driver@example.com',
    firstName: 'D',
    lastName: 'River',
    jti: 'jti-driver',
  };

  const dto = {
    firstName: 'New',
    lastName: 'Driver',
    phone: '+254711111111',
    email: 'newdriver@example.com',
    licenseNumber: 'LIC-999',
    initialPassword: 'password123',
  };

  beforeEach(async () => {
    prisma = {
      client: {
        user: { findFirst: jest.fn() },
        driver: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
        dailyAssignment: { findMany: jest.fn().mockResolvedValue([]) },
        ownershipPlan: { findMany: jest.fn().mockResolvedValue([]) },
        motorcycle: { findMany: jest.fn().mockResolvedValue([]) },
        $transaction: jest.fn(),
      },
    };

    const cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DriverService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantCacheService, useValue: cache },
      ],
    }).compile();

    service = moduleRef.get(DriverService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('create', () => {
    it('creates a User and Driver in a transaction, leaking no passwordHash', async () => {
      prisma.client.user.findFirst.mockResolvedValue(null);
      prisma.client.driver.findFirst.mockResolvedValue(null);
      jest.spyOn(passwordUtil, 'hashPassword').mockResolvedValue('hashed');

      const userCreate = jest.fn().mockResolvedValue({
        id: 'user-1',
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        isActive: true,
      });
      const driverCreate = jest.fn().mockResolvedValue({ id: 'driver-1', userId: 'user-1' });
      prisma.client.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({ user: { create: userCreate }, driver: { create: driverCreate } }),
      );

      const result = await service.create(dto, owner);

      expect(userCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: UserRole.RIDER, passwordHash: 'hashed' }),
          select: expect.not.objectContaining({ passwordHash: true }),
        }),
      );
      expect(result).not.toHaveProperty('passwordHash');
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('passes driverType through to the Driver row when given, letting the DB default to RIDER otherwise', async () => {
      prisma.client.user.findFirst.mockResolvedValue(null);
      prisma.client.driver.findFirst.mockResolvedValue(null);
      jest.spyOn(passwordUtil, 'hashPassword').mockResolvedValue('hashed');

      const driverCreate = jest.fn().mockResolvedValue({ id: 'driver-1', userId: 'user-1' });
      prisma.client.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({
          user: { create: jest.fn().mockResolvedValue({ id: 'user-1' }) },
          driver: { create: driverCreate },
        }),
      );

      await service.create({ ...dto, driverType: DriverType.TRUCK_DRIVER }, owner);

      expect(driverCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ driverType: DriverType.TRUCK_DRIVER }),
        }),
      );
    });

    it('throws Conflict on a duplicate email', async () => {
      prisma.client.user.findFirst.mockResolvedValueOnce({ id: 'existing' });

      await expect(service.create(dto, owner)).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws Conflict on a duplicate license number', async () => {
      prisma.client.user.findFirst.mockResolvedValue(null);
      prisma.client.driver.findFirst.mockResolvedValueOnce({ id: 'existing' });

      await expect(service.create(dto, owner)).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws Forbidden when a RIDER attempts to create, with no Prisma calls made', async () => {
      await expect(service.create(dto, driverActor)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.client.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.client.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('sets both driver.isActive and user.isActive to false', async () => {
      prisma.client.driver.findUnique.mockResolvedValue({ id: 'driver-1', userId: 'user-1' });

      const driverUpdate = jest.fn();
      const userUpdate = jest.fn();
      prisma.client.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({ driver: { update: driverUpdate }, user: { update: userUpdate } }),
      );

      await service.deactivate('driver-1', owner);

      expect(driverUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'driver-1' },
          data: expect.objectContaining({ isActive: false }),
        }),
      );
      expect(userUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { isActive: false },
        }),
      );
    });
  });

  describe('list', () => {
    it('defaults to active-only drivers', async () => {
      prisma.client.driver.findMany.mockResolvedValue([]);

      await service.list({}, owner);

      expect(prisma.client.driver.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('omits the isActive filter when includeInactive is true', async () => {
      prisma.client.driver.findMany.mockResolvedValue([]);

      await service.list({ includeInactive: true }, owner);

      expect(prisma.client.driver.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  describe('search', () => {
    function driverRow(
      id: string,
      firstName: string,
      lastName: string,
      phone: string,
      isActive = true,
    ) {
      return {
        id,
        isActive,
        user: { id: `user-${id}`, firstName, lastName, phone, isActive: true },
      };
    }

    it('issues exactly one dailyAssignment query for the whole page of results, not one per result', async () => {
      prisma.client.driver.findMany.mockResolvedValue([
        driverRow('d1', 'Juma', 'A', '+254711111111'),
        driverRow('d2', 'Juma', 'B', '+254711111112'),
        driverRow('d3', 'Juma', 'C', '+254711111113'),
      ]);
      prisma.client.dailyAssignment.findMany.mockResolvedValue([]);

      await service.search({ q: 'Juma' }, owner);

      expect(prisma.client.dailyAssignment.findMany).toHaveBeenCalledTimes(1);
    });

    it('skips the dailyAssignment query entirely when there are no driver matches', async () => {
      prisma.client.driver.findMany.mockResolvedValue([]);

      await service.search({ q: 'nobody' }, owner);

      expect(prisma.client.dailyAssignment.findMany).not.toHaveBeenCalled();
    });

    it('requests limit+1 rows and reports hasMore when more matched than the limit', async () => {
      prisma.client.driver.findMany.mockResolvedValue([
        driverRow('d1', 'Juma', 'A', '+254711111111'),
        driverRow('d2', 'Juma', 'B', '+254711111112'),
        driverRow('d3', 'Juma', 'C', '+254711111113'),
      ]);
      prisma.client.dailyAssignment.findMany.mockResolvedValue([]);

      const result = await service.search({ q: 'Juma', limit: 2 }, owner);

      expect(prisma.client.driver.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 }),
      );
      expect(result.results).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });

    it('reports hasMore false when exactly the limit (or fewer) matched', async () => {
      prisma.client.driver.findMany.mockResolvedValue([
        driverRow('d1', 'Juma', 'A', '+254711111111'),
      ]);
      prisma.client.dailyAssignment.findMany.mockResolvedValue([]);

      const result = await service.search({ q: 'Juma', limit: 2 }, owner);

      expect(result.results).toHaveLength(1);
      expect(result.hasMore).toBe(false);
    });

    it('returns an empty result with no query at all for a blank/whitespace-only q', async () => {
      const result = await service.search({ q: '   ' }, owner);

      expect(result).toEqual({ results: [], hasMore: false });
      expect(prisma.client.driver.findMany).not.toHaveBeenCalled();
    });

    it('splits a multi-word query into tokens that each must match some field', async () => {
      prisma.client.driver.findMany.mockResolvedValue([]);

      await service.search({ q: 'Juma Bakari' }, owner);

      expect(prisma.client.driver.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: [
              expect.objectContaining({ OR: expect.any(Array) }),
              expect.objectContaining({ OR: expect.any(Array) }),
            ],
          }),
        }),
      );
    });

    it('throws Forbidden when called by a RIDER, with no Prisma calls made', async () => {
      await expect(service.search({ q: 'Juma' }, driverActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.client.driver.findMany).not.toHaveBeenCalled();
    });

    it('defaults to active-only drivers', async () => {
      prisma.client.driver.findMany.mockResolvedValue([]);

      await service.search({ q: 'Juma' }, owner);

      expect(prisma.client.driver.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
      );
    });

    it('omits the isActive filter when includeInactive is true', async () => {
      prisma.client.driver.findMany.mockResolvedValue([]);

      await service.search({ q: 'Juma', includeInactive: true }, owner);

      expect(prisma.client.driver.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.not.objectContaining({ isActive: true }) }),
      );
    });

    it("carries each result's isActive flag", async () => {
      prisma.client.driver.findMany.mockResolvedValue([
        driverRow('d1', 'Juma', 'A', '+254711111111', false),
      ]);

      const result = await service.search({ q: 'Juma', includeInactive: true }, owner);

      expect(result.results[0].isActive).toBe(false);
    });

    it("folds an ACTIVE ownership plan's vehicle plate into that token's match, with no assignment rows yet", async () => {
      prisma.client.driver.findMany.mockResolvedValue([]);
      prisma.client.ownershipPlan.findMany.mockResolvedValue([
        { driverId: 'd1', motorcycleId: 'm1' },
      ]);
      prisma.client.motorcycle.findMany.mockResolvedValue([
        { id: 'm1', registrationNumber: 'T999 XYZ' },
      ]);

      await service.search({ q: 'T999' }, owner);

      expect(prisma.client.motorcycle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['m1'] } } }),
      );
      expect(prisma.client.driver.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: [
              expect.objectContaining({
                OR: expect.arrayContaining([{ id: { in: ['d1'] } }]),
              }),
            ],
          }),
        }),
      );
    });

    it('skips the motorcycle query entirely when there are no ACTIVE plans', async () => {
      prisma.client.driver.findMany.mockResolvedValue([]);
      prisma.client.ownershipPlan.findMany.mockResolvedValue([]);

      await service.search({ q: 'Juma' }, owner);

      expect(prisma.client.motorcycle.findMany).not.toHaveBeenCalled();
    });

    it('issues exactly one ownershipPlan query and one motorcycle query regardless of token count', async () => {
      prisma.client.driver.findMany.mockResolvedValue([]);
      prisma.client.ownershipPlan.findMany.mockResolvedValue([
        { driverId: 'd1', motorcycleId: 'm1' },
      ]);
      prisma.client.motorcycle.findMany.mockResolvedValue([
        { id: 'm1', registrationNumber: 'T999 XYZ' },
      ]);

      await service.search({ q: 'Juma Bakari' }, owner);

      expect(prisma.client.ownershipPlan.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.client.motorcycle.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('reactivate', () => {
    it('sets both driver.isActive and user.isActive to true and clears deletedAt', async () => {
      prisma.client.driver.findUnique.mockResolvedValue({ id: 'driver-1', userId: 'user-1' });

      const driverUpdate = jest.fn().mockResolvedValue({ id: 'driver-1', isActive: true });
      const userUpdate = jest.fn().mockResolvedValue({ id: 'user-1', isActive: true });
      prisma.client.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({ driver: { update: driverUpdate }, user: { update: userUpdate } }),
      );

      await service.reactivate('driver-1', owner);

      expect(driverUpdate).toHaveBeenCalledWith({
        where: { id: 'driver-1' },
        data: { isActive: true, deletedAt: null },
      });
      expect(userUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { isActive: true },
        }),
      );
    });

    it('throws NotFound when the driver does not exist', async () => {
      prisma.client.driver.findUnique.mockResolvedValue(null);

      await expect(service.reactivate('missing', owner)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Forbidden when called by a RIDER', async () => {
      await expect(service.reactivate('driver-1', driverActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.client.driver.findUnique).not.toHaveBeenCalled();
    });
  });
});
