import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { GuarantorService } from './guarantor.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('GuarantorService', () => {
  let service: GuarantorService;
  let prisma: {
    client: {
      rider: { findUnique: jest.Mock };
      guarantor: {
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

  const rider = { id: 'rider-1', tenantId: 'tenant-1' };
  const dto = { firstName: 'Grace', lastName: 'Guarantor', phone: '+254700000123' };

  beforeEach(async () => {
    prisma = {
      client: {
        rider: { findUnique: jest.fn() },
        guarantor: {
          findUnique: jest.fn(),
          findMany: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [GuarantorService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(GuarantorService);
  });

  describe('create', () => {
    it('succeeds for a valid OWNER request', async () => {
      prisma.client.rider.findUnique.mockResolvedValue(rider);
      prisma.client.guarantor.create.mockResolvedValue({ id: 'guarantor-1', ...dto });

      const result = await service.create('rider-1', dto, owner);

      expect(prisma.client.guarantor.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: owner.tenantId, riderId: 'rider-1' }),
        }),
      );
      expect(result).toEqual({ id: 'guarantor-1', ...dto });
    });

    it('throws NotFound when the rider does not exist', async () => {
      prisma.client.rider.findUnique.mockResolvedValue(null);

      await expect(service.create('rider-1', dto, owner)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.client.guarantor.create).not.toHaveBeenCalled();
    });

    it('throws Forbidden when called by a RIDER', async () => {
      await expect(service.create('rider-1', dto, riderActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.client.rider.findUnique).not.toHaveBeenCalled();
    });
  });
});
