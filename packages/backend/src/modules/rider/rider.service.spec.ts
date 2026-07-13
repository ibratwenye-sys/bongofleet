import { Test } from '@nestjs/testing';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RiderService } from './rider.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import * as passwordUtil from '../auth/utils/password.util';

describe('RiderService', () => {
  let service: RiderService;
  let prisma: {
    client: {
      user: { findFirst: jest.Mock };
      rider: { findFirst: jest.Mock; findUnique: jest.Mock };
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

  const riderActor: AuthenticatedUser = {
    userId: 'user-rider',
    tenantId: 'tenant-1',
    role: UserRole.RIDER,
    email: 'rider@example.com',
    firstName: 'R',
    lastName: 'Ider',
    jti: 'jti-rider',
  };

  const dto = {
    firstName: 'New',
    lastName: 'Rider',
    phone: '+254711111111',
    email: 'newrider@example.com',
    licenseNumber: 'LIC-999',
    initialPassword: 'password123',
  };

  beforeEach(async () => {
    prisma = {
      client: {
        user: { findFirst: jest.fn() },
        rider: { findFirst: jest.fn(), findUnique: jest.fn() },
        $transaction: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [RiderService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(RiderService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('create', () => {
    it('creates a User and Rider in a transaction, leaking no passwordHash', async () => {
      prisma.client.user.findFirst.mockResolvedValue(null);
      prisma.client.rider.findFirst.mockResolvedValue(null);
      jest.spyOn(passwordUtil, 'hashPassword').mockResolvedValue('hashed');

      const userCreate = jest.fn().mockResolvedValue({
        id: 'user-1',
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        isActive: true,
      });
      const riderCreate = jest.fn().mockResolvedValue({ id: 'rider-1', userId: 'user-1' });
      prisma.client.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({ user: { create: userCreate }, rider: { create: riderCreate } }),
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
      prisma.client.rider.findFirst.mockResolvedValueOnce({ id: 'existing' });

      await expect(service.create(dto, owner)).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws Forbidden when a RIDER attempts to create, with no Prisma calls made', async () => {
      await expect(service.create(dto, riderActor)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.client.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.client.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('sets both rider.isActive and user.isActive to false', async () => {
      prisma.client.rider.findUnique.mockResolvedValue({ id: 'rider-1', userId: 'user-1' });

      const riderUpdate = jest.fn();
      const userUpdate = jest.fn();
      prisma.client.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({ rider: { update: riderUpdate }, user: { update: userUpdate } }),
      );

      await service.deactivate('rider-1', owner);

      expect(riderUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rider-1' },
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
});
