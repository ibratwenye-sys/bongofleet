import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TenantService } from './tenant.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('TenantService (Stage G Part 2)', () => {
  let service: TenantService;
  let prisma: { client: { tenant: { findUnique: jest.Mock; update: jest.Mock } } };

  const owner: AuthenticatedUser = {
    userId: 'user-owner',
    tenantId: 'tenant-1',
    role: UserRole.OWNER,
    email: 'owner@example.com',
    firstName: 'O',
    lastName: 'Wner',
    jti: 'jti-owner',
  };

  const manager: AuthenticatedUser = {
    ...owner,
    userId: 'user-manager',
    role: UserRole.MANAGER,
    jti: 'jti-manager',
  };

  const tenantRow = {
    id: 'tenant-1',
    name: 'Acme Fleet Ltd',
    physicalAddress: null,
    directorName: null,
  };

  beforeEach(async () => {
    prisma = { client: { tenant: { findUnique: jest.fn(), update: jest.fn() } } };
    const moduleRef = await Test.createTestingModule({
      providers: [TenantService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(TenantService);
  });

  describe('role gating', () => {
    it('rejects a non-OWNER with Forbidden on read', async () => {
      await expect(service.getSettings(manager)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a non-OWNER with Forbidden on write', async () => {
      await expect(
        service.updateSettings({ physicalAddress: 'x' }, manager),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getSettings', () => {
    it("returns the OWNER's own tenant's physicalAddress and directorName", async () => {
      prisma.client.tenant.findUnique.mockResolvedValue(tenantRow);

      const result = await service.getSettings(owner);

      expect(prisma.client.tenant.findUnique).toHaveBeenCalledWith({ where: { id: 'tenant-1' } });
      expect(result).toEqual({
        name: 'Acme Fleet Ltd',
        physicalAddress: null,
        directorName: null,
      });
    });

    // There is no route parameter here to point at another tenant - the
    // service only ever reads actor.tenantId. This documents that an
    // anomalous own-tenant lookup (never expected in practice) is a
    // NotFound, matching the "unknown or someone else's" shape used
    // everywhere else, never a Forbidden.
    it('returns NotFound, not Forbidden, if the row for actor.tenantId does not exist', async () => {
      prisma.client.tenant.findUnique.mockResolvedValue(null);

      await expect(service.getSettings(owner)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateSettings', () => {
    it('updates physicalAddress and directorName for the OWNER own tenant only', async () => {
      prisma.client.tenant.findUnique.mockResolvedValue(tenantRow);
      prisma.client.tenant.update.mockResolvedValue({
        ...tenantRow,
        physicalAddress: 'Uhuru Street, Dar es Salaam',
        directorName: 'Amina Said',
      });

      const result = await service.updateSettings(
        { physicalAddress: 'Uhuru Street, Dar es Salaam', directorName: 'Amina Said' },
        owner,
      );

      expect(prisma.client.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: { physicalAddress: 'Uhuru Street, Dar es Salaam', directorName: 'Amina Said' },
      });
      expect(result.physicalAddress).toBe('Uhuru Street, Dar es Salaam');
      expect(result.directorName).toBe('Amina Said');
    });

    it('returns NotFound, not Forbidden, if the row for actor.tenantId does not exist', async () => {
      prisma.client.tenant.findUnique.mockResolvedValue(null);

      await expect(service.updateSettings({ physicalAddress: 'x' }, owner)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.client.tenant.update).not.toHaveBeenCalled();
    });
  });
});
