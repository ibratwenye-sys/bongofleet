import { Test } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MotorcycleStatus, UserRole } from '@prisma/client';
import { MotorcycleService } from './motorcycle.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('MotorcycleService', () => {
  let service: MotorcycleService;
  let prisma: {
    client: {
      motorcycle: {
        findFirst: jest.Mock;
        findUnique: jest.Mock;
        findMany: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
      };
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

  const dto = { registrationNumber: 'KDA-001A' };

  beforeEach(async () => {
    prisma = {
      client: {
        motorcycle: {
          findFirst: jest.fn(),
          findUnique: jest.fn(),
          findMany: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [MotorcycleService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(MotorcycleService);
  });

  describe('create', () => {
    it('succeeds for a valid owner request', async () => {
      prisma.client.motorcycle.findFirst.mockResolvedValue(null);
      prisma.client.motorcycle.create.mockResolvedValue({ id: 'moto-1', ...dto });

      const result = await service.create(dto, owner);

      expect(prisma.client.motorcycle.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tenantId: owner.tenantId }) }),
      );
      expect(result).toEqual({ id: 'moto-1', ...dto });
    });

    it('throws Conflict on a duplicate registrationNumber', async () => {
      prisma.client.motorcycle.findFirst.mockResolvedValueOnce({ id: 'existing' });

      await expect(service.create(dto, owner)).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws Conflict on a duplicate gpsDeviceId', async () => {
      prisma.client.motorcycle.findFirst
        .mockResolvedValueOnce(null) // registrationNumber check passes
        .mockResolvedValueOnce({ id: 'existing' }); // gpsDeviceId check fails

      await expect(service.create({ ...dto, gpsDeviceId: 'GPS-1' }, owner)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('throws Forbidden when a RIDER attempts to create, with no Prisma calls made', async () => {
      await expect(service.create(dto, riderActor)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.client.motorcycle.findFirst).not.toHaveBeenCalled();
      expect(prisma.client.motorcycle.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('changes the status', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue({
        id: 'moto-1',
        registrationNumber: 'KDA-001A',
        gpsDeviceId: null,
        status: MotorcycleStatus.ACTIVE,
      });
      prisma.client.motorcycle.update.mockResolvedValue({
        id: 'moto-1',
        status: MotorcycleStatus.MAINTENANCE,
      });

      const result = await service.update(
        'moto-1',
        { status: MotorcycleStatus.MAINTENANCE },
        owner,
      );

      expect(prisma.client.motorcycle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'moto-1' },
          data: expect.objectContaining({ status: MotorcycleStatus.MAINTENANCE }),
        }),
      );
      expect(result.status).toBe(MotorcycleStatus.MAINTENANCE);
    });

    it('throws NotFound when the motorcycle does not exist', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing', { status: MotorcycleStatus.MAINTENANCE }, owner),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deactivate', () => {
    it('sets isActive=false and deletedAt', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue({ id: 'moto-1', isActive: true });
      prisma.client.motorcycle.update.mockResolvedValue({
        id: 'moto-1',
        isActive: false,
        deletedAt: new Date(),
      });

      await service.deactivate('moto-1', owner);

      expect(prisma.client.motorcycle.update).toHaveBeenCalledWith({
        where: { id: 'moto-1' },
        data: { isActive: false, deletedAt: expect.any(Date) },
      });
    });
  });
});
