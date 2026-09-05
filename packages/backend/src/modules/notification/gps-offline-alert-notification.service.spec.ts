import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { GpsSource } from '@prisma/client';
import { GpsOfflineAlertNotificationService } from './gps-offline-alert-notification.service';
import { MailerService } from './mailer.service';
import { PrismaService } from '../../prisma/prisma.service';

// 08:00 UTC = 11:00 Africa/Dar_es_Salaam (fixed UTC+3, no DST) - used
// throughout for deterministic working-hours-gating math.
const NOW = new Date('2026-09-05T08:00:00.000Z');

function hoursAgo(hours: number, from: Date = NOW): Date {
  return new Date(from.getTime() - hours * 60 * 60 * 1000);
}

function motorcycle(
  overrides: Partial<{
    id: string;
    registrationNumber: string;
    gpsLocations: Array<{
      source: GpsSource;
      latitude: number;
      longitude: number;
      recordedAt: Date;
    }>;
  }> = {},
) {
  return {
    id: 'moto-1',
    registrationNumber: 'REG-1',
    gpsLocations: [] as Array<{
      source: GpsSource;
      latitude: number;
      longitude: number;
      recordedAt: Date;
    }>,
    ...overrides,
  };
}

function fix(recordedAt: Date) {
  return { source: GpsSource.PHONE, latitude: -6.8, longitude: 39.2, recordedAt };
}

describe('GpsOfflineAlertNotificationService', () => {
  let service: GpsOfflineAlertNotificationService;
  let prisma: {
    client: {
      tenant: { findMany: jest.Mock };
      motorcycle: { findMany: jest.Mock };
      gpsOfflineAlert: { findMany: jest.Mock; createMany: jest.Mock };
      user: { findMany: jest.Mock };
    };
  };
  let mailer: { send: jest.Mock };
  let schedulerRegistry: { addCronJob: jest.Mock };

  // A stateful fake for gpsOfflineAlert - a plain jest.fn() returning a
  // fixed value can't represent "already alerted today, not yet alerted
  // tomorrow" across two real scanAndNotify() calls, which is exactly what
  // the per-day-dedup / new-day-re-alerts tests need to prove.
  let alertRows: Array<{
    tenantId: string;
    motorcycleId: string;
    alertDate: Date;
    lastRecordedAt: Date | null;
    sentTo: string;
  }>;

  const tenant = {
    id: 'tenant-1',
    name: 'Acme Fleet',
    contactEmail: null as string | null,
    trackingStartHour: null as number | null,
    trackingEndHour: null as number | null,
  };

  beforeEach(async () => {
    alertRows = [];
    prisma = {
      client: {
        tenant: { findMany: jest.fn().mockResolvedValue([tenant]) },
        motorcycle: { findMany: jest.fn().mockResolvedValue([]) },
        gpsOfflineAlert: {
          findMany: jest.fn(
            (args: { where: { motorcycleId: { in: string[] }; alertDate: Date } }) =>
              Promise.resolve(
                alertRows.filter(
                  (r) =>
                    args.where.motorcycleId.in.includes(r.motorcycleId) &&
                    r.alertDate.getTime() === args.where.alertDate.getTime(),
                ),
              ),
          ),
          createMany: jest.fn((args: { data: typeof alertRows }) => {
            alertRows.push(...args.data);
            return Promise.resolve({ count: args.data.length });
          }),
        },
        user: { findMany: jest.fn().mockResolvedValue([{ email: 'owner@acme.test' }]) },
      },
    };
    mailer = { send: jest.fn().mockResolvedValue(true) };
    schedulerRegistry = { addCronJob: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GpsOfflineAlertNotificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailerService, useValue: mailer },
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

    service = moduleRef.get(GpsOfflineAlertNotificationService);
  });

  it('does not self-schedule a cron job in the test environment', () => {
    service.onModuleInit();
    expect(schedulerRegistry.addCronJob).not.toHaveBeenCalled();
  });

  it('alerts a vehicle that stopped reporting, with a human-readable offline duration', async () => {
    prisma.client.motorcycle.findMany.mockResolvedValue([
      motorcycle({ gpsLocations: [fix(hoursAgo(3.33))] }), // ~3h20m ago
    ]);

    const result = await service.scanAndNotify(NOW);

    expect(result).toEqual({ tenantsScanned: 1, tenantsNotified: 1, alertsSent: 1 });
    expect(mailer.send).toHaveBeenCalledTimes(1);
    const message = mailer.send.mock.calls[0][0];
    expect(message.to).toEqual(['owner@acme.test']);
    expect(message.subject).toContain('1 vehicle(s) offline');
    expect(message.text).toContain('REG-1');
    expect(message.text).toContain('3 h 20 min');
  });

  it('never alerts a vehicle that has literally never reported a single fix', async () => {
    prisma.client.motorcycle.findMany.mockResolvedValue([motorcycle({ gpsLocations: [] })]);

    const result = await service.scanAndNotify(NOW);

    expect(result.alertsSent).toBe(0);
    expect(mailer.send).not.toHaveBeenCalled();
    expect(prisma.client.gpsOfflineAlert.createMany).not.toHaveBeenCalled();
  });

  it('never alerts a recently-reporting (online) vehicle', async () => {
    prisma.client.motorcycle.findMany.mockResolvedValue([
      motorcycle({ gpsLocations: [fix(hoursAgo(0.01))] }), // ~36s ago, well within the stale window
    ]);

    const result = await service.scanAndNotify(NOW);

    expect(result.alertsSent).toBe(0);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('excludes trackingMode: NONE vehicles at the query level, not in-memory', async () => {
    await service.scanAndNotify(NOW);

    const where = prisma.client.motorcycle.findMany.mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
    expect(where.trackingMode).toEqual({ not: 'NONE' });
  });

  it('applies working-hours gating: skips entirely when both hours are set and now falls outside the window (no motorcycle query even attempted)', async () => {
    const restrictedTenant = { ...tenant, trackingStartHour: 13, trackingEndHour: 17 };
    prisma.client.tenant.findMany.mockResolvedValue([restrictedTenant]);
    prisma.client.motorcycle.findMany.mockResolvedValue([
      motorcycle({ gpsLocations: [fix(hoursAgo(3))] }),
    ]);

    const result = await service.scanAndNotify(NOW); // local hour 11, window [13,17)

    expect(result.alertsSent).toBe(0);
    expect(prisma.client.motorcycle.findMany).not.toHaveBeenCalled();
  });

  it('applies working-hours gating: proceeds normally when both hours are set and now falls inside the window', async () => {
    const restrictedTenant = { ...tenant, trackingStartHour: 9, trackingEndHour: 18 };
    prisma.client.tenant.findMany.mockResolvedValue([restrictedTenant]);
    prisma.client.motorcycle.findMany.mockResolvedValue([
      motorcycle({ gpsLocations: [fix(hoursAgo(3))] }),
    ]);

    const result = await service.scanAndNotify(NOW); // local hour 11, window [9,18)

    expect(result.alertsSent).toBe(1);
  });

  it('treats either hour being null as unrestricted (never requires BOTH to be set)', async () => {
    const halfSetTenant = { ...tenant, trackingStartHour: 13, trackingEndHour: null };
    prisma.client.tenant.findMany.mockResolvedValue([halfSetTenant]);
    prisma.client.motorcycle.findMany.mockResolvedValue([
      motorcycle({ gpsLocations: [fix(hoursAgo(3))] }),
    ]);

    const result = await service.scanAndNotify(NOW); // would be "outside" if both were enforced

    expect(result.alertsSent).toBe(1);
  });

  it('sends only once per day for the same still-offline vehicle - a second scan the same day is silent', async () => {
    prisma.client.motorcycle.findMany.mockResolvedValue([
      motorcycle({ gpsLocations: [fix(hoursAgo(3))] }),
    ]);

    const first = await service.scanAndNotify(NOW);
    expect(first.alertsSent).toBe(1);
    expect(mailer.send).toHaveBeenCalledTimes(1);

    const second = await service.scanAndNotify(NOW);
    expect(second.alertsSent).toBe(0);
    expect(mailer.send).toHaveBeenCalledTimes(1); // still 1 - no second send
  });

  it('re-alerts the same still-offline vehicle on a new day - a deliberate daily reminder, not a dedup bug', async () => {
    prisma.client.motorcycle.findMany.mockResolvedValue([
      motorcycle({ gpsLocations: [fix(hoursAgo(3, NOW))] }),
    ]);

    const day1 = await service.scanAndNotify(NOW);
    expect(day1.alertsSent).toBe(1);

    const nextDay = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    prisma.client.motorcycle.findMany.mockResolvedValue([
      motorcycle({ gpsLocations: [fix(hoursAgo(3 + 24, nextDay))] }), // still offline, now longer
    ]);
    const day2 = await service.scanAndNotify(nextDay);

    expect(day2.alertsSent).toBe(1);
    expect(mailer.send).toHaveBeenCalledTimes(2);
  });

  it('skips a tenant with no recipients instead of recording an unsent alert', async () => {
    prisma.client.motorcycle.findMany.mockResolvedValue([
      motorcycle({ gpsLocations: [fix(hoursAgo(3))] }),
    ]);
    prisma.client.user.findMany.mockResolvedValue([]);

    const result = await service.scanAndNotify(NOW);

    expect(result.alertsSent).toBe(0);
    expect(mailer.send).not.toHaveBeenCalled();
    expect(prisma.client.gpsOfflineAlert.createMany).not.toHaveBeenCalled();
  });

  it('does not record an alert when the email fails, so the next run retries', async () => {
    prisma.client.motorcycle.findMany.mockResolvedValue([
      motorcycle({ gpsLocations: [fix(hoursAgo(3))] }),
    ]);
    mailer.send.mockResolvedValue(false);

    const result = await service.scanAndNotify(NOW);

    expect(result.alertsSent).toBe(0);
    expect(prisma.client.gpsOfflineAlert.createMany).not.toHaveBeenCalled();
  });

  it("continues with the remaining tenants when one tenant's scan fails", async () => {
    const tenantB = {
      id: 'tenant-2',
      name: 'Bora Fleet',
      contactEmail: null,
      trackingStartHour: null,
      trackingEndHour: null,
    };
    prisma.client.tenant.findMany.mockResolvedValue([tenant, tenantB]);
    prisma.client.motorcycle.findMany
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([motorcycle({ id: 'moto-b', gpsLocations: [fix(hoursAgo(3))] })]);

    const result = await service.scanAndNotify(NOW);

    expect(result.tenantsScanned).toBe(2);
    expect(result.tenantsNotified).toBe(1);
    expect(result.alertsSent).toBe(1);
  });
});
