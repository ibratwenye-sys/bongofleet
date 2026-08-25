import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GpsSource, UserRole } from '@prisma/client';
import { GpsService } from './gps.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('GpsService', () => {
  let service: GpsService;
  let prisma: {
    client: {
      driver: { findUnique: jest.Mock };
      dailyAssignment: { findMany: jest.Mock };
      motorcycle: { findMany: jest.Mock; findUnique: jest.Mock };
      gpsLocation: { createMany: jest.Mock; findMany: jest.Mock };
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

  const owner: AuthenticatedUser = { ...rider, userId: 'user-owner', role: UserRole.OWNER };
  const manager: AuthenticatedUser = { ...rider, userId: 'user-manager', role: UserRole.MANAGER };

  beforeEach(async () => {
    prisma = {
      client: {
        driver: { findUnique: jest.fn().mockResolvedValue({ id: 'driver-1' }) },
        dailyAssignment: { findMany: jest.fn().mockResolvedValue([]) },
        motorcycle: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
        gpsLocation: {
          createMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn().mockResolvedValue([]),
        },
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

  describe('getFleetPositions (Stage I3, §7)', () => {
    it('rejects RIDER with Forbidden, and issues no query', async () => {
      await expect(service.getFleetPositions(rider)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.client.motorcycle.findMany).not.toHaveBeenCalled();
    });

    it('issues exactly one motorcycle query for the whole fleet, not one per vehicle', async () => {
      prisma.client.motorcycle.findMany.mockResolvedValue([
        {
          id: 'moto-1',
          registrationNumber: 'KDA-001A',
          vehicleType: 'MOTORBIKE',
          gpsLocations: [],
        },
        { id: 'moto-2', registrationNumber: 'KDA-002A', vehicleType: 'CAR', gpsLocations: [] },
      ]);

      await service.getFleetPositions(owner);

      expect(prisma.client.motorcycle.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.client.motorcycle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('resolves a live vehicle from its nested gpsLocations via resolveCurrentPosition', async () => {
      prisma.client.motorcycle.findMany.mockResolvedValue([
        {
          id: 'moto-1',
          registrationNumber: 'KDA-001A',
          vehicleType: 'MOTORBIKE',
          gpsLocations: [
            {
              source: GpsSource.PHONE,
              latitude: -6.79,
              longitude: 39.2,
              recordedAt: new Date(Date.now() - 60_000),
            },
          ],
        },
      ]);

      const [result] = await service.getFleetPositions(manager);

      expect(result).toEqual(
        expect.objectContaining({
          motorcycleId: 'moto-1',
          registrationNumber: 'KDA-001A',
          vehicleType: 'MOTORBIKE',
          offline: false,
          latitude: -6.79,
          longitude: 39.2,
          source: 'PHONE',
        }),
      );
    });

    it('an active vehicle with no GPS history at all still appears, offline with lastRecordedAt: null', async () => {
      prisma.client.motorcycle.findMany.mockResolvedValue([
        { id: 'moto-1', registrationNumber: 'KDA-NEW', vehicleType: 'TRUCK', gpsLocations: [] },
      ]);

      const [result] = await service.getFleetPositions(owner);

      expect(result).toEqual({
        motorcycleId: 'moto-1',
        registrationNumber: 'KDA-NEW',
        vehicleType: 'TRUCK',
        offline: true,
        lastRecordedAt: null,
      });
    });
  });

  describe('getVehiclePath (Stage I3, §7)', () => {
    it('rejects RIDER with Forbidden, and issues no query', async () => {
      await expect(service.getVehiclePath('moto-1', '2026-08-20', rider)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.client.motorcycle.findUnique).not.toHaveBeenCalled();
    });

    it('404s when the motorcycle does not exist (or belongs to another tenant)', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue(null);

      await expect(
        service.getVehiclePath('moto-missing', '2026-08-20', owner),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.client.gpsLocation.findMany).not.toHaveBeenCalled();
    });

    it('queries the exact Africa/Dar_es_Salaam day range for the given date, ordered oldest first', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue({ id: 'moto-1' });
      prisma.client.gpsLocation.findMany.mockResolvedValue([]);

      await service.getVehiclePath('moto-1', '2026-08-20', owner);

      expect(prisma.client.gpsLocation.findMany).toHaveBeenCalledWith({
        where: {
          motorcycleId: 'moto-1',
          recordedAt: {
            gte: new Date('2026-08-19T21:00:00.000Z'),
            lt: new Date('2026-08-20T21:00:00.000Z'),
          },
        },
        orderBy: { recordedAt: 'asc' },
        select: { recordedAt: true, latitude: true, longitude: true, speedKmh: true },
      });
    });

    it('maps rows to plain path points, speedKmh null when absent', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue({ id: 'moto-1' });
      prisma.client.gpsLocation.findMany.mockResolvedValue([
        {
          recordedAt: new Date('2026-08-20T09:00:00.000Z'),
          latitude: -6.79,
          longitude: 39.2,
          speedKmh: 24.5,
        },
        {
          recordedAt: new Date('2026-08-20T09:01:00.000Z'),
          latitude: -6.8,
          longitude: 39.21,
          speedKmh: null,
        },
      ]);

      const result = await service.getVehiclePath('moto-1', '2026-08-20', manager);

      expect(result).toEqual([
        {
          recordedAt: '2026-08-20T09:00:00.000Z',
          latitude: -6.79,
          longitude: 39.2,
          speedKmh: 24.5,
        },
        {
          recordedAt: '2026-08-20T09:01:00.000Z',
          latitude: -6.8,
          longitude: 39.21,
          speedKmh: null,
        },
      ]);
    });

    it('rejects a malformed date with BadRequest', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue({ id: 'moto-1' });

      await expect(service.getVehiclePath('moto-1', 'not-a-date', owner)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
