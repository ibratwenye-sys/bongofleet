import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { GpsService } from './gps.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('GpsService', () => {
  let service: GpsService;
  let prisma: {
    client: {
      driver: { findUnique: jest.Mock };
      dailyAssignment: { findMany: jest.Mock };
      gpsLocation: { createMany: jest.Mock };
    };
  };

  const rider: AuthenticatedUser = {
    userId: 'user-rider',
    tenantId: 'tenant-1',
    role: UserRole.RIDER,
    email: 'rider@example.com',
    firstName: 'R',
    lastName: 'Ider',
    jti: 'jti-rider',
  };

  beforeEach(async () => {
    prisma = {
      client: {
        driver: { findUnique: jest.fn().mockResolvedValue({ id: 'driver-1' }) },
        dailyAssignment: { findMany: jest.fn().mockResolvedValue([]) },
        gpsLocation: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [GpsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(GpsService);
  });

  function fix(recordedAt: string, overrides: Partial<Record<string, unknown>> = {}) {
    return { recordedAt, latitude: -6.79, longitude: 39.2, ...overrides };
  }

  it("resolves motorcycleId from the rider's own assignment on the fix's date and stores the row", async () => {
    prisma.client.dailyAssignment.findMany.mockResolvedValue([
      { assignedDate: new Date('2026-08-10T00:00:00.000Z'), motorcycleId: 'moto-1' },
    ]);

    const result = await service.recordPhoneFixes(
      { fixes: [fix('2026-08-10T09:00:00.000Z')] },
      rider,
    );

    expect(result).toEqual({ accepted: 1, discarded: 0 });
    expect(prisma.client.gpsLocation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          tenantId: 'tenant-1',
          driverId: 'driver-1',
          motorcycleId: 'moto-1',
          source: 'PHONE',
          latitude: -6.79,
          longitude: 39.2,
        }),
      ],
    });
  });

  it('discards a fix with no assignment on its date, without erroring the batch or the other fixes in it', async () => {
    prisma.client.dailyAssignment.findMany.mockResolvedValue([
      { assignedDate: new Date('2026-08-10T00:00:00.000Z'), motorcycleId: 'moto-1' },
    ]);

    const result = await service.recordPhoneFixes(
      {
        fixes: [
          fix('2026-08-10T09:00:00.000Z'), // has an assignment
          fix('2026-08-05T09:00:00.000Z'), // no assignment that date
        ],
      },
      rider,
    );

    expect(result).toEqual({ accepted: 1, discarded: 1 });
    expect(prisma.client.gpsLocation.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ motorcycleId: 'moto-1' })],
    });
  });

  it('a batch spanning two different dates with assignments on both stores both fixes against the right motorcycle', async () => {
    prisma.client.dailyAssignment.findMany.mockResolvedValue([
      { assignedDate: new Date('2026-08-10T00:00:00.000Z'), motorcycleId: 'moto-1' },
      { assignedDate: new Date('2026-08-11T00:00:00.000Z'), motorcycleId: 'moto-2' },
    ]);

    const result = await service.recordPhoneFixes(
      {
        fixes: [fix('2026-08-10T09:00:00.000Z'), fix('2026-08-11T09:00:00.000Z')],
      },
      rider,
    );

    expect(result).toEqual({ accepted: 2, discarded: 0 });
    const { data } = prisma.client.gpsLocation.createMany.mock.calls[0][0];
    expect(data).toHaveLength(2);
    expect(data.find((r: { motorcycleId: string }) => r.motorcycleId === 'moto-1')).toBeDefined();
    expect(data.find((r: { motorcycleId: string }) => r.motorcycleId === 'moto-2')).toBeDefined();
  });

  it('issues exactly one dailyAssignment query for the whole batch, not one per fix', async () => {
    prisma.client.dailyAssignment.findMany.mockResolvedValue([
      { assignedDate: new Date('2026-08-10T00:00:00.000Z'), motorcycleId: 'moto-1' },
      { assignedDate: new Date('2026-08-11T00:00:00.000Z'), motorcycleId: 'moto-2' },
    ]);

    await service.recordPhoneFixes(
      {
        fixes: [
          fix('2026-08-10T06:00:00.000Z'),
          fix('2026-08-10T09:00:00.000Z'),
          fix('2026-08-10T12:00:00.000Z'),
          fix('2026-08-11T06:00:00.000Z'),
          fix('2026-08-11T09:00:00.000Z'),
        ],
      },
      rider,
    );

    expect(prisma.client.dailyAssignment.findMany).toHaveBeenCalledTimes(1);
    // Two distinct dates queried, not five.
    const { where } = prisma.client.dailyAssignment.findMany.mock.calls[0][0];
    expect(where.assignedDate.in).toHaveLength(2);
  });

  it('skips createMany entirely when every fix in the batch is discarded', async () => {
    prisma.client.dailyAssignment.findMany.mockResolvedValue([]);

    const result = await service.recordPhoneFixes(
      { fixes: [fix('2026-08-10T09:00:00.000Z')] },
      rider,
    );

    expect(result).toEqual({ accepted: 0, discarded: 1 });
    expect(prisma.client.gpsLocation.createMany).not.toHaveBeenCalled();
  });

  it('throws Forbidden when no driver profile is associated with the account, with no assignment/location queries made', async () => {
    prisma.client.driver.findUnique.mockResolvedValue(null);

    await expect(
      service.recordPhoneFixes({ fixes: [fix('2026-08-10T09:00:00.000Z')] }, rider),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.client.dailyAssignment.findMany).not.toHaveBeenCalled();
    expect(prisma.client.gpsLocation.createMany).not.toHaveBeenCalled();
  });

  it('carries optional fields (speed/heading/accuracy/battery) through to the stored row when present, and omits them when absent', async () => {
    prisma.client.dailyAssignment.findMany.mockResolvedValue([
      { assignedDate: new Date('2026-08-10T00:00:00.000Z'), motorcycleId: 'moto-1' },
    ]);

    await service.recordPhoneFixes(
      {
        fixes: [
          fix('2026-08-10T09:00:00.000Z', {
            speedKmh: 24.5,
            heading: 118,
            accuracyMeters: 12,
            batteryPercent: 64,
          }),
        ],
      },
      rider,
    );

    const { data } = prisma.client.gpsLocation.createMany.mock.calls[0][0];
    expect(data[0]).toEqual(
      expect.objectContaining({
        speedKmh: 24.5,
        heading: 118,
        accuracyMeters: 12,
        batteryPercent: 64,
      }),
    );
  });
});
