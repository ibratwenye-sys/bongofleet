import { Test } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { DriverService } from './driver.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import * as passwordUtil from '../auth/utils/password.util';

describe('DriverService', () => {
  let service: DriverService;
  let prisma: {
    client: {
      user: { findFirst: jest.Mock };
      driver: { findFirst: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
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
        $transaction: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [DriverService, { provide: PrismaService, useValue: prisma }],
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
