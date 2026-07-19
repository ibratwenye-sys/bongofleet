import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PaymentAlertKind, PaymentStatus, Prisma } from '@prisma/client';
import { MissedPaymentNotificationService } from './missed-payment-notification.service';
import { MailerService } from './mailer.service';
import { PrismaService } from '../../prisma/prisma.service';

// Fixed "now" so date math in the specs is deterministic: 2026-07-19 UTC.
const NOW = new Date('2026-07-19T05:00:00.000Z');

function daysFromNow(days: number): Date {
  const date = new Date(Date.UTC(2026, 6, 19));
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function makePayment(amount: number, status: PaymentStatus) {
  return { amount: new Prisma.Decimal(amount), status };
}

function makeAssignment(
  overrides: Partial<{
    id: string;
    assignedDate: Date;
    targetAmount: Prisma.Decimal;
    dailyPayments: Array<{ amount: Prisma.Decimal; status: PaymentStatus }>;
  }> = {},
) {
  return {
    id: 'assignment-1',
    tenantId: 'tenant-1',
    assignedDate: daysFromNow(-1),
    targetAmount: new Prisma.Decimal(10000),
    dailyPayments: [] as Array<{ amount: Prisma.Decimal; status: PaymentStatus }>,
    rider: { user: { firstName: 'Juma', lastName: 'Rider' } },
    motorcycle: { registrationNumber: 'KDA-123' },
    ...overrides,
  };
}

describe('MissedPaymentNotificationService', () => {
  let service: MissedPaymentNotificationService;
  let prisma: {
    client: {
      tenant: { findMany: jest.Mock };
      dailyAssignment: { findMany: jest.Mock };
      user: { findMany: jest.Mock };
      assignmentAlert: { createMany: jest.Mock };
    };
  };
  let mailer: { send: jest.Mock };
  let schedulerRegistry: { addCronJob: jest.Mock };

  const tenant = { id: 'tenant-1', name: 'Acme Fleet', contactEmail: null as string | null };

  beforeEach(async () => {
    prisma = {
      client: {
        tenant: { findMany: jest.fn().mockResolvedValue([tenant]) },
        dailyAssignment: { findMany: jest.fn().mockResolvedValue([]) },
        user: { findMany: jest.fn().mockResolvedValue([{ email: 'owner@acme.test' }]) },
        assignmentAlert: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      },
    };
    mailer = { send: jest.fn().mockResolvedValue(true) };
    schedulerRegistry = { addCronJob: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MissedPaymentNotificationService,
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

    service = moduleRef.get(MissedPaymentNotificationService);
  });

  it('does not self-schedule a cron job in the test environment', () => {
    service.onModuleInit();
    expect(schedulerRegistry.addCronJob).not.toHaveBeenCalled();
  });

  it('classifies no-payment vs shortfall, digests both, and records the alerts', async () => {
    prisma.client.dailyAssignment.findMany.mockResolvedValue([
      makeAssignment({ id: 'a-missed' }),
      makeAssignment({
        id: 'a-short',
        dailyPayments: [makePayment(4000, PaymentStatus.COMPLETED)],
      }),
    ]);

    const result = await service.scanAndNotify(NOW);

    expect(result).toEqual({ tenantsScanned: 1, tenantsNotified: 1, alertsSent: 2 });
    expect(mailer.send).toHaveBeenCalledTimes(1);

    const message = mailer.send.mock.calls[0][0];
    expect(message.to).toEqual(['owner@acme.test']);
    expect(message.subject).toContain('2 daily payment(s)');
    expect(message.text).toContain('NO PAYMENT RECORDED:');
    expect(message.text).toContain('PAID UNDER TARGET:');
    expect(message.text).toContain('Juma Rider');
    expect(message.text).toContain('KDA-123');
    expect(message.text).toContain('short by 6000.00');

    expect(prisma.client.assignmentAlert.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          dailyAssignmentId: 'a-missed',
          kind: PaymentAlertKind.NO_PAYMENT,
        }),
        expect.objectContaining({
          dailyAssignmentId: 'a-short',
          kind: PaymentAlertKind.SHORTFALL,
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('never alerts an assignment that met its target', async () => {
    prisma.client.dailyAssignment.findMany.mockResolvedValue([
      makeAssignment({
        dailyPayments: [
          makePayment(6000, PaymentStatus.COMPLETED),
          makePayment(4000, PaymentStatus.PENDING),
        ],
      }),
    ]);

    const result = await service.scanAndNotify(NOW);

    expect(result.tenantsNotified).toBe(0);
    expect(mailer.send).not.toHaveBeenCalled();
    expect(prisma.client.assignmentAlert.createMany).not.toHaveBeenCalled();
  });

  it('excludes FAILED payments but counts PENDING ones, noting them in the digest', async () => {
    prisma.client.dailyAssignment.findMany.mockResolvedValue([
      makeAssignment({
        dailyPayments: [
          makePayment(10000, PaymentStatus.FAILED),
          makePayment(3000, PaymentStatus.PENDING),
        ],
      }),
    ]);

    const result = await service.scanAndNotify(NOW);

    expect(result.alertsSent).toBe(1);
    const message = mailer.send.mock.calls[0][0];
    expect(message.text).toContain('paid 3000.00 of 10000.00');
    expect(message.text).toContain('3000.00 of this is pending reconciliation');
    expect(prisma.client.assignmentAlert.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ kind: PaymentAlertKind.SHORTFALL })],
      }),
    );
  });

  it('queries only past days inside the lookback window, skipping already-alerted rows', async () => {
    await service.scanAndNotify(NOW);

    const where = prisma.client.dailyAssignment.findMany.mock.calls[0][0].where;
    expect(where.alert).toBeNull();
    expect(where.assignedDate.lt).toEqual(new Date(Date.UTC(2026, 6, 19)));
    expect(where.assignedDate.gte).toEqual(new Date(Date.UTC(2026, 6, 12)));
  });

  it('does not record alerts when the email fails, so the next run retries', async () => {
    prisma.client.dailyAssignment.findMany.mockResolvedValue([makeAssignment()]);
    mailer.send.mockResolvedValue(false);

    const result = await service.scanAndNotify(NOW);

    expect(result.alertsSent).toBe(0);
    expect(prisma.client.assignmentAlert.createMany).not.toHaveBeenCalled();
  });

  it('skips a tenant with no recipients instead of recording unsent alerts', async () => {
    prisma.client.dailyAssignment.findMany.mockResolvedValue([makeAssignment()]);
    prisma.client.user.findMany.mockResolvedValue([]);

    const result = await service.scanAndNotify(NOW);

    expect(result.alertsSent).toBe(0);
    expect(mailer.send).not.toHaveBeenCalled();
    expect(prisma.client.assignmentAlert.createMany).not.toHaveBeenCalled();
  });

  it('continues with the remaining tenants when one tenant fails', async () => {
    const tenantB = { id: 'tenant-2', name: 'Bora Fleet', contactEmail: null };
    prisma.client.tenant.findMany.mockResolvedValue([tenant, tenantB]);
    prisma.client.dailyAssignment.findMany
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([makeAssignment({ id: 'a-b' })]);

    const result = await service.scanAndNotify(NOW);

    expect(result.tenantsScanned).toBe(2);
    expect(result.tenantsNotified).toBe(1);
    expect(result.alertsSent).toBe(1);
  });
});
