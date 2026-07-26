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
      driver: { findUnique: jest.Mock };
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

  const driverActor: AuthenticatedUser = {
    userId: 'user-driver',
    tenantId: 'tenant-1',
    role: UserRole.RIDER,
    email: 'driver@example.com',
    firstName: 'D',
    lastName: 'River',
    jti: 'jti-driver',
  };

  const driver = { id: 'driver-1', tenantId: 'tenant-1' };
  const dto = { firstName: 'Grace', lastName: 'Guarantor', phone: '+254700000123' };

  beforeEach(async () => {
    prisma = {
      client: {
        driver: { findUnique: jest.fn() },
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
      prisma.client.driver.findUnique.mockResolvedValue(driver);
      prisma.client.guarantor.create.mockResolvedValue({ id: 'guarantor-1', ...dto });

      const result = await service.create('driver-1', dto, owner);

      expect(prisma.client.guarantor.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: owner.tenantId, driverId: 'driver-1' }),
        }),
      );
      expect(result).toEqual({ id: 'guarantor-1', ...dto });
    });

    it('throws NotFound when the driver does not exist', async () => {
      prisma.client.driver.findUnique.mockResolvedValue(null);

      await expect(service.create('driver-1', dto, owner)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.client.guarantor.create).not.toHaveBeenCalled();
    });

    it('throws Forbidden when called by a RIDER', async () => {
      await expect(service.create('driver-1', dto, driverActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.client.driver.findUnique).not.toHaveBeenCalled();
    });
  });
});
