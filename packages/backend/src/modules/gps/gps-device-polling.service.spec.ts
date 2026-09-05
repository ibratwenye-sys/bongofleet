import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { GpsSource } from '@prisma/client';
import { GpsDevicePollingService } from './gps-device-polling.service';
import { TraccarApiError, TraccarClient, TraccarDevice, TraccarPosition } from './traccar-client';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCredentials } from '../../common/credentials-encryption';

// Self-contained, same as credentials-encryption.spec.ts - not read from
// the real .env, so this suite never depends on it being configured.
process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

function encryptedToken(token: string): Uint8Array {
  return new Uint8Array(encryptCredentials(JSON.stringify({ token })));
}

function device(overrides: Partial<TraccarDevice> = {}): TraccarDevice {
  return { id: 1, uniqueId: 'TRACCAR-UID-1', name: 'Truck 1', status: 'online', ...overrides };
}

function position(overrides: Partial<TraccarPosition> = {}): TraccarPosition {
  return {
    id: 100,
    deviceId: 1,
    latitude: -6.8,
    longitude: 39.2,
    speed: 10, // knots
    course: 90,
    accuracy: 5,
    fixTime: '2026-09-04T10:00:00.000Z',
    deviceTime: '2026-09-04T10:00:00.000Z',
    ...overrides,
  };
}

describe('GpsDevicePollingService', () => {
  let service: GpsDevicePollingService;
  let prisma: {
    client: {
      gpsProviderConfig: { findMany: jest.Mock; update: jest.Mock };
      motorcycle: { findMany: jest.Mock };
      gpsLocation: { groupBy: jest.Mock; createMany: jest.Mock };
    };
  };
  let traccar: { getDevices: jest.Mock; getPositions: jest.Mock };

  const baseConfig = {
    id: 'config-1',
    tenantId: 'tenant-1',
    baseUrl: 'https://demo.traccar.org',
    credentialsEncrypted: encryptedToken('tok-1'),
  };

  beforeEach(async () => {
    prisma = {
      client: {
        gpsProviderConfig: { findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) },
        motorcycle: { findMany: jest.fn().mockResolvedValue([]) },
        gpsLocation: {
          groupBy: jest.fn().mockResolvedValue([]),
          createMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      },
    };
    traccar = { getDevices: jest.fn(), getPositions: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GpsDevicePollingService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: SchedulerRegistry, useValue: { addCronJob: jest.fn() } },
        { provide: TraccarClient, useValue: traccar },
      ],
    }).compile();
    service = moduleRef.get(GpsDevicePollingService);
  });

  describe('pollTenantConfig', () => {
    it('matches a device to the right motorcycle by uniqueId and writes its position', async () => {
      traccar.getDevices.mockResolvedValue([device()]);
      traccar.getPositions.mockResolvedValue([position()]);
      prisma.client.motorcycle.findMany.mockResolvedValue([
        { id: 'moto-1', gpsDeviceId: 'TRACCAR-UID-1' },
      ]);
      prisma.client.gpsLocation.groupBy.mockResolvedValue([]); // no prior fix

      const written = await service.pollTenantConfig(baseConfig);

      expect(written).toBe(1);
      expect(prisma.client.gpsLocation.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            tenantId: 'tenant-1',
            motorcycleId: 'moto-1',
            source: GpsSource.DEVICE,
            driverId: null,
            latitude: -6.8,
            longitude: 39.2,
            speedKmh: 10 * 1.852,
            heading: 90,
            accuracyMeters: 5,
            recordedAt: new Date('2026-09-04T10:00:00.000Z'),
          }),
        ],
      });
      // Success updates lastPolledAt/lastSuccessAt, never touches isActive.
      expect(prisma.client.gpsProviderConfig.update).toHaveBeenCalledWith({
        where: { id: 'config-1' },
        data: { lastPolledAt: expect.any(Date), lastSuccessAt: expect.any(Date) },
      });
    });

    it('skips a device with no matching motorcycle, without error', async () => {
      traccar.getDevices.mockResolvedValue([device({ uniqueId: 'UNPAIRED-DEVICE' })]);
      traccar.getPositions.mockResolvedValue([position()]);
      prisma.client.motorcycle.findMany.mockResolvedValue([]); // nothing paired to this uniqueId

      const written = await service.pollTenantConfig(baseConfig);

      expect(written).toBe(0);
      expect(prisma.client.gpsLocation.createMany).not.toHaveBeenCalled();
      // Still counted as a successful poll - an unmatched device is not a failure.
      expect(prisma.client.gpsProviderConfig.update).toHaveBeenCalledWith({
        where: { id: 'config-1' },
        data: { lastPolledAt: expect.any(Date), lastSuccessAt: expect.any(Date) },
      });
    });

    it('skips a fix that is older than or equal to the existing latest DEVICE fix', async () => {
      traccar.getDevices.mockResolvedValue([device()]);
      traccar.getPositions.mockResolvedValue([position({ fixTime: '2026-09-04T10:00:00.000Z' })]);
      prisma.client.motorcycle.findMany.mockResolvedValue([
        { id: 'moto-1', gpsDeviceId: 'TRACCAR-UID-1' },
      ]);
      prisma.client.gpsLocation.groupBy.mockResolvedValue([
        { motorcycleId: 'moto-1', _max: { recordedAt: new Date('2026-09-04T10:00:00.000Z') } },
      ]);

      const written = await service.pollTenantConfig(baseConfig);

      expect(written).toBe(0);
      expect(prisma.client.gpsLocation.createMany).not.toHaveBeenCalled();
    });

    it('writes a fix newer than the existing latest DEVICE fix', async () => {
      traccar.getDevices.mockResolvedValue([device()]);
      traccar.getPositions.mockResolvedValue([position({ fixTime: '2026-09-04T10:05:00.000Z' })]);
      prisma.client.motorcycle.findMany.mockResolvedValue([
        { id: 'moto-1', gpsDeviceId: 'TRACCAR-UID-1' },
      ]);
      prisma.client.gpsLocation.groupBy.mockResolvedValue([
        { motorcycleId: 'moto-1', _max: { recordedAt: new Date('2026-09-04T10:00:00.000Z') } },
      ]);

      const written = await service.pollTenantConfig(baseConfig);

      expect(written).toBe(1);
      expect(prisma.client.gpsLocation.createMany).toHaveBeenCalledTimes(1);
    });

    it('the "latest DEVICE fix per motorcycle" step is exactly one query, regardless of how many motorcycles matched', async () => {
      const devices = [
        device({ id: 1, uniqueId: 'UID-1' }),
        device({ id: 2, uniqueId: 'UID-2' }),
        device({ id: 3, uniqueId: 'UID-3' }),
      ];
      const positions = [
        position({ id: 100, deviceId: 1, fixTime: '2026-09-04T10:05:00.000Z' }),
        position({ id: 101, deviceId: 2, fixTime: '2026-09-04T10:05:00.000Z' }),
        position({ id: 102, deviceId: 3, fixTime: '2026-09-04T10:05:00.000Z' }),
      ];
      traccar.getDevices.mockResolvedValue(devices);
      traccar.getPositions.mockResolvedValue(positions);
      prisma.client.motorcycle.findMany.mockResolvedValue([
        { id: 'moto-1', gpsDeviceId: 'UID-1' },
        { id: 'moto-2', gpsDeviceId: 'UID-2' },
        { id: 'moto-3', gpsDeviceId: 'UID-3' },
      ]);
      prisma.client.gpsLocation.groupBy.mockResolvedValue([]);

      const written = await service.pollTenantConfig(baseConfig);

      expect(written).toBe(3);
      expect(prisma.client.gpsLocation.groupBy).toHaveBeenCalledTimes(1);
      expect(prisma.client.gpsLocation.createMany).toHaveBeenCalledTimes(1);
    });

    it('on a simulated 401, sets lastErrorMessage and leaves isActive untouched', async () => {
      traccar.getDevices.mockRejectedValue(new TraccarApiError('Traccar returned 401', 401));
      traccar.getPositions.mockResolvedValue([]);

      const written = await service.pollTenantConfig(baseConfig);

      expect(written).toBe(0);
      expect(prisma.client.gpsLocation.createMany).not.toHaveBeenCalled();
      const updateCall = prisma.client.gpsProviderConfig.update.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: 'config-1' });
      expect(updateCall.data.lastErrorMessage).toContain('401');
      expect(updateCall.data.lastPolledAt).toBeInstanceOf(Date);
      // isActive is never mentioned in the failure-path update - Prisma
      // leaves it exactly as it was in the DB.
      expect(updateCall.data).not.toHaveProperty('isActive');
    });
  });

  describe('scanAll', () => {
    it("one tenant's simulated failure does not stop a second tenant's config from being polled in the same run", async () => {
      const configA = { ...baseConfig, id: 'config-a', tenantId: 'tenant-a' };
      const configB = {
        ...baseConfig,
        id: 'config-b',
        tenantId: 'tenant-b',
        credentialsEncrypted: encryptedToken('tok-b'),
      };
      prisma.client.gpsProviderConfig.findMany.mockResolvedValue([configA, configB]);

      // Both tenants' Traccar calls succeed - the failure is a genuinely
      // unexpected one (a DB write erroring) for tenant A specifically, on
      // the final success-path update. This is deliberate: every Traccar-
      // side failure mode (network error, non-2xx, bad stored credentials)
      // is already caught INSIDE pollTenantConfig and turned into a
      // recorded lastErrorMessage rather than a throw (per the task's own
      // "never throw out of the per-tenant iteration" requirement) - so the
      // only way to exercise scanAll's OWN try/catch is a failure from
      // somewhere pollTenantConfig doesn't already handle internally.
      traccar.getDevices.mockResolvedValue([device()]);
      traccar.getPositions.mockResolvedValue([position()]);
      prisma.client.motorcycle.findMany.mockResolvedValue([
        { id: 'moto-1', gpsDeviceId: 'TRACCAR-UID-1' },
      ]);
      prisma.client.gpsProviderConfig.update.mockImplementation(
        (args: { where: { id: string } }) => {
          if (args.where.id === 'config-a') {
            return Promise.reject(new Error('DB write failed for tenant A'));
          }
          return Promise.resolve({});
        },
      );

      const result = await service.scanAll();

      expect(result.configsScanned).toBe(2);
      expect(result.configsFailed).toBe(1);
      expect(result.fixesWritten).toBe(1); // tenant B's poll still ran and wrote its fix
    });
  });
});
