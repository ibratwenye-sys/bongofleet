import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { MaintenanceReminderKind } from '@prisma/client';
import { MaintenanceReminderNotificationService } from './maintenance-reminder-notification.service';
import { MailerService } from './mailer.service';
import { PrismaService } from '../../prisma/prisma.service';

const NOW = new Date('2026-07-20T05:00:00.000Z');

function daysFromNow(days: number): Date {
  const date = new Date(Date.UTC(2026, 6, 20));
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function makeBike(
  overrides: Partial<{
    id: string;
    registrationNumber: string;
    currentMileage: number;
    log: {
      id: string;
      description: string;
      nextServiceDate: Date | null;
      nextServiceMileage: number | null;
      reminders: Array<{ kind: MaintenanceReminderKind }>;
    } | null;
  }> = {},
) {
  const log =
    overrides.log === undefined
      ? {
          id: 'log-1',
          description: 'Oil change',
          nextServiceDate: daysFromNow(30),
          nextServiceMileage: null,
          reminders: [] as Array<{ kind: MaintenanceReminderKind }>,
        }
      : overrides.log;
  return {
    id: overrides.id ?? 'bike-1',
    registrationNumber: overrides.registrationNumber ?? 'KDA-1',
    currentMileage: overrides.currentMileage ?? 0,
    maintenanceLogs: log ? [log] : [],
  };
}

describe('MaintenanceReminderNotificationService', () => {
  let service: MaintenanceReminderNotificationService;
  let prisma: {
    client: {
      tenant: { findMany: jest.Mock };
      motorcycle: { findMany: jest.Mock };
      user: { findMany: jest.Mock };
      maintenanceReminder: { createMany: jest.Mock };
    };
  };
  let mailer: { send: jest.Mock };
  let schedulerRegistry: { addCronJob: jest.Mock };

  const tenant = { id: 'tenant-1', name: 'Acme Fleet', contactEmail: null as string | null };

  beforeEach(async () => {
    prisma = {
      client: {
        tenant: { findMany: jest.fn().mockResolvedValue([tenant]) },
        motorcycle: { findMany: jest.fn().mockResolvedValue([]) },
        user: { findMany: jest.fn().mockResolvedValue([{ email: 'owner@acme.test' }]) },
        maintenanceReminder: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      },
    };
    mailer = { send: jest.fn().mockResolvedValue(true) };
    schedulerRegistry = { addCronJob: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MaintenanceReminderNotificationService,
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

    service = moduleRef.get(MaintenanceReminderNotificationService);
  });

  it('does not self-schedule a cron job in the test environment', () => {
    service.onModuleInit();
    expect(schedulerRegistry.addCronJob).not.toHaveBeenCalled();
  });

  it('flags a bike overdue by date and one due-soon by mileage, records the reminders', async () => {
    prisma.client.motorcycle.findMany.mockResolvedValue([
      makeBike({
        id: 'b-overdue',
        registrationNumber: 'KDA-OVER',
        log: {
          id: 'log-overdue',
          description: 'Brake service',
          nextServiceDate: daysFromNow(-2),
          nextServiceMileage: null,
          reminders: [],
        },
      }),
      makeBike({
        id: 'b-soon',
        registrationNumber: 'KDA-SOON',
        currentMileage: 9700, // within 500 of 10000
        log: {
          id: 'log-soon',
          description: 'Chain service',
          nextServiceDate: null,
          nextServiceMileage: 10000,
          reminders: [],
        },
      }),
    ]);

    const result = await service.scanAndNotify(NOW);

    expect(result).toEqual({ tenantsScanned: 1, tenantsNotified: 1, remindersSent: 2 });
    const message = mailer.send.mock.calls[0][0];
    expect(message.subject).toContain('2 motorcycle(s)');
    expect(message.text).toContain('OVERDUE:');
    expect(message.text).toContain('KDA-OVER');
    expect(message.text).toContain('DUE SOON:');
    expect(message.text).toContain('KDA-SOON');
    expect(prisma.client.maintenanceReminder.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ maintenanceLogId: 'log-overdue', kind: 'OVERDUE' }),
        expect.objectContaining({ maintenanceLogId: 'log-soon', kind: 'DUE_SOON' }),
      ],
      skipDuplicates: true,
    });
  });

  it('treats a bike past its mileage target as OVERDUE, not due-soon', async () => {
    prisma.client.motorcycle.findMany.mockResolvedValue([
      makeBike({
        currentMileage: 10500,
        log: {
          id: 'log-x',
          description: 'Service',
          nextServiceDate: null,
          nextServiceMileage: 10000,
          reminders: [],
        },
      }),
    ]);

    const result = await service.scanAndNotify(NOW);
    expect(result.remindersSent).toBe(1);
    expect(prisma.client.maintenanceReminder.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ kind: 'OVERDUE' })],
      }),
    );
  });

  it('skips a target already reminded for the same kind, but escalates due-soon to overdue', async () => {
    prisma.client.motorcycle.findMany.mockResolvedValue([
      // Already reminded DUE_SOON and still only due-soon: nothing new.
      makeBike({
        id: 'b-quiet',
        log: {
          id: 'log-quiet',
          description: 'A',
          nextServiceDate: daysFromNow(5),
          nextServiceMileage: null,
          reminders: [{ kind: MaintenanceReminderKind.DUE_SOON }],
        },
      }),
      // Reminded DUE_SOON before, now overdue: escalates.
      makeBike({
        id: 'b-esc',
        registrationNumber: 'KDA-ESC',
        log: {
          id: 'log-esc',
          description: 'B',
          nextServiceDate: daysFromNow(-1),
          nextServiceMileage: null,
          reminders: [{ kind: MaintenanceReminderKind.DUE_SOON }],
        },
      }),
    ]);

    const result = await service.scanAndNotify(NOW);
    expect(result.remindersSent).toBe(1);
    expect(prisma.client.maintenanceReminder.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ maintenanceLogId: 'log-esc', kind: 'OVERDUE' })],
      }),
    );
  });

  it('sends nothing when no bike is due', async () => {
    prisma.client.motorcycle.findMany.mockResolvedValue([
      makeBike({
        log: {
          id: 'l',
          description: 'x',
          nextServiceDate: daysFromNow(60),
          nextServiceMileage: null,
          reminders: [],
        },
      }),
    ]);

    const result = await service.scanAndNotify(NOW);
    expect(result.tenantsNotified).toBe(0);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('does not record reminders when the email fails', async () => {
    prisma.client.motorcycle.findMany.mockResolvedValue([
      makeBike({
        log: {
          id: 'l',
          description: 'x',
          nextServiceDate: daysFromNow(-1),
          nextServiceMileage: null,
          reminders: [],
        },
      }),
    ]);
    mailer.send.mockResolvedValue(false);

    const result = await service.scanAndNotify(NOW);
    expect(result.remindersSent).toBe(0);
    expect(prisma.client.maintenanceReminder.createMany).not.toHaveBeenCalled();
  });

  it('continues to other tenants when one fails', async () => {
    prisma.client.tenant.findMany.mockResolvedValue([
      tenant,
      { id: 'tenant-2', name: 'B', contactEmail: null },
    ]);
    prisma.client.motorcycle.findMany
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([
        makeBike({
          log: {
            id: 'l2',
            description: 'x',
            nextServiceDate: daysFromNow(-1),
            nextServiceMileage: null,
            reminders: [],
          },
        }),
      ]);

    const result = await service.scanAndNotify(NOW);
    expect(result.tenantsScanned).toBe(2);
    expect(result.tenantsNotified).toBe(1);
    expect(result.remindersSent).toBe(1);
  });
});
