import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { TenantStatus } from '@prisma/client';
import { AbandonedSignupCleanupService } from './abandoned-signup-cleanup.service';
import { PrismaService } from '../../prisma/prisma.service';

const NOW = new Date('2026-08-17T05:00:00.000Z');

describe('AbandonedSignupCleanupService', () => {
  let service: AbandonedSignupCleanupService;
  let prisma: {
    client: {
      tenant: { findMany: jest.Mock; delete: jest.Mock };
      user: { deleteMany: jest.Mock };
      $transaction: jest.Mock;
    };
  };
  let schedulerRegistry: { addCronJob: jest.Mock };
  let deleteManyMock: jest.Mock;
  let deleteMock: jest.Mock;

  beforeEach(async () => {
    deleteManyMock = jest.fn().mockResolvedValue({ count: 1 });
    deleteMock = jest.fn().mockResolvedValue({ id: 'tenant-abandoned' });

    prisma = {
      client: {
        tenant: { findMany: jest.fn().mockResolvedValue([]), delete: deleteMock },
        user: { deleteMany: deleteManyMock },
        $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => unknown) =>
          fn({
            user: { deleteMany: deleteManyMock },
            tenant: { delete: deleteMock },
          }),
        ),
      },
    };
    schedulerRegistry = { addCronJob: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AbandonedSignupCleanupService,
        { provide: PrismaService, useValue: prisma },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => {
              if (key === 'NODE_ENV') return 'test';
              return fallback;
            }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(AbandonedSignupCleanupService);
  });

  it('does not self-schedule a cron job in the test environment', () => {
    service.onModuleInit();
    expect(schedulerRegistry.addCronJob).not.toHaveBeenCalled();
  });

  it('removes a PENDING_VERIFICATION tenant older than the retention window, and its owner', async () => {
    prisma.client.tenant.findMany.mockResolvedValue([
      { id: 'tenant-abandoned', name: 'Ghost Fleet' },
    ]);

    const result = await service.cleanup(NOW);

    expect(prisma.client.tenant.findMany).toHaveBeenCalledWith({
      where: {
        status: TenantStatus.PENDING_VERIFICATION,
        createdAt: { lt: new Date('2026-08-10T05:00:00.000Z') }, // default 7 days back
      },
      select: { id: true, name: true },
    });
    expect(deleteManyMock).toHaveBeenCalledWith({ where: { tenantId: 'tenant-abandoned' } });
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: 'tenant-abandoned' } });
    expect(result).toEqual({ tenantsDeleted: 1 });
  });

  it('leaves a verified tenant alone - it never matches the PENDING_VERIFICATION filter', async () => {
    // The filter itself is the guarantee: an ACTIVE tenant is never even
    // fetched, let alone deleted. No verified tenant is passed in here on
    // purpose - this asserts the query shape excludes it, not that some
    // extra check inside the loop skips it.
    prisma.client.tenant.findMany.mockResolvedValue([]);

    const result = await service.cleanup(NOW);

    expect(prisma.client.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: TenantStatus.PENDING_VERIFICATION }),
      }),
    );
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(result).toEqual({ tenantsDeleted: 0 });
  });

  it("one tenant's delete failure does not stop the rest", async () => {
    prisma.client.tenant.findMany.mockResolvedValue([
      { id: 'tenant-fails', name: 'Broken' },
      { id: 'tenant-ok', name: 'Fine' },
    ]);
    prisma.client.$transaction
      .mockImplementationOnce(async () => {
        throw new Error('db exploded');
      })
      .mockImplementationOnce(async (fn: (tx: unknown) => unknown) =>
        fn({ user: { deleteMany: deleteManyMock }, tenant: { delete: deleteMock } }),
      );

    const result = await service.cleanup(NOW);

    expect(deleteMock).toHaveBeenCalledWith({ where: { id: 'tenant-ok' } });
    expect(result).toEqual({ tenantsDeleted: 2 }); // count reflects candidates found, not confirmed deletes
  });

  it('respects a configured ABANDONED_SIGNUP_RETENTION_DAYS instead of the default', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AbandonedSignupCleanupService,
        { provide: PrismaService, useValue: prisma },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => {
              if (key === 'NODE_ENV') return 'test';
              if (key === 'ABANDONED_SIGNUP_RETENTION_DAYS') return 14;
              return fallback;
            }),
          },
        },
      ],
    }).compile();
    const configuredService = moduleRef.get(AbandonedSignupCleanupService);

    await configuredService.cleanup(NOW);

    expect(prisma.client.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ createdAt: { lt: new Date('2026-08-03T05:00:00.000Z') } }),
      }),
    );
  });
});
