import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { OwnershipPlanStatus, PaymentStatus, Prisma } from '@prisma/client';
import { OwnershipPlanGeneratorService } from './ownership-plan-generator.service';
import { PrismaService } from '../../prisma/prisma.service';

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

interface FakePlan {
  id: string;
  tenantId: string;
  driverId: string;
  motorcycleId: string;
  dailyAmount: Prisma.Decimal;
  totalPrice: Prisma.Decimal;
  downPayment: Prisma.Decimal;
  startDate: Date;
  activeWeekdays: number[];
  status: OwnershipPlanStatus;
  completedAt: Date | null;
}

interface FakeAssignment {
  id: string;
  tenantId: string;
  driverId: string;
  motorcycleId: string;
  assignedDate: Date;
  targetAmount: Prisma.Decimal;
  ownershipPlanId: string | null;
  reference: string;
}

interface FakePayment {
  dailyAssignmentId: string;
  amount: Prisma.Decimal;
  status: PaymentStatus;
}

function makePlan(overrides: Partial<FakePlan> & { id: string; driverId: string }): FakePlan {
  return {
    tenantId: 'tenant-1',
    motorcycleId: `veh-${overrides.driverId}`,
    dailyAmount: new Prisma.Decimal(12000),
    totalPrice: new Prisma.Decimal(1_800_000),
    downPayment: new Prisma.Decimal(0),
    startDate: utc(2026, 8, 3),
    activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
    status: OwnershipPlanStatus.ACTIVE,
    completedAt: null,
    ...overrides,
  };
}

function createFakePrisma(options: {
  plans: FakePlan[];
  assignments?: FakeAssignment[];
  payments?: FakePayment[];
  tenants?: Array<{ id: string; name: string; isActive: boolean }>;
  failingTenantId?: string;
}) {
  const state = {
    plans: options.plans,
    assignments: options.assignments ?? [],
    payments: options.payments ?? [],
    tenants: options.tenants ?? [{ id: 'tenant-1', name: 'Acme Fleet', isActive: true }],
  };
  let idCounter = 0;

  const client = {
    tenant: {
      findMany: jest.fn(() => Promise.resolve(state.tenants.filter((t) => t.isActive))),
    },
    ownershipPlan: {
      findMany: jest.fn(
        ({ where }: { where: { tenantId: string; status?: OwnershipPlanStatus } }) => {
          if (where.tenantId === options.failingTenantId) {
            return Promise.reject(new Error('boom'));
          }
          return Promise.resolve(
            state.plans
              .filter(
                (p) =>
                  p.tenantId === where.tenantId && (!where.status || p.status === where.status),
              )
              .map((p) => ({ ...p })),
          );
        },
      ),
      updateMany: jest.fn(
        ({ where, data }: { where: { id: { in: string[] } }; data: Partial<FakePlan> }) => {
          let count = 0;
          for (const plan of state.plans) {
            if (where.id.in.includes(plan.id)) {
              Object.assign(plan, data);
              count += 1;
            }
          }
          return Promise.resolve({ count });
        },
      ),
    },
    dailyAssignment: {
      findMany: jest.fn(
        ({
          where,
        }: {
          where: {
            ownershipPlanId?: { in: string[] };
            tenantId?: string;
            driverId?: { in: string[] };
            assignedDate?: { gte?: Date; lte?: Date };
          };
        }) => {
          let rows = state.assignments;
          if (where.ownershipPlanId) {
            rows = rows.filter(
              (a) =>
                a.ownershipPlanId !== null && where.ownershipPlanId!.in.includes(a.ownershipPlanId),
            );
          }
          if (where.tenantId) {
            rows = rows.filter((a) => a.tenantId === where.tenantId);
          }
          if (where.driverId) {
            rows = rows.filter((a) => where.driverId!.in.includes(a.driverId));
          }
          if (where.assignedDate) {
            const { gte, lte } = where.assignedDate;
            rows = rows.filter(
              (a) =>
                (!gte || a.assignedDate.getTime() >= gte.getTime()) &&
                (!lte || a.assignedDate.getTime() <= lte.getTime()),
            );
          }
          return Promise.resolve(rows.map((r) => ({ ...r })));
        },
      ),
      createMany: jest.fn(({ data }: { data: Omit<FakeAssignment, 'id'>[] }) => {
        for (const row of data) {
          idCounter += 1;
          state.assignments.push({ id: `gen-${idCounter}`, ...row });
        }
        return Promise.resolve({ count: data.length });
      }),
    },
    dailyPayment: {
      groupBy: jest.fn(
        ({ where }: { where: { dailyAssignmentId: { in: string[] }; status: PaymentStatus } }) => {
          const sums = new Map<string, Prisma.Decimal>();
          for (const payment of state.payments) {
            if (
              !where.dailyAssignmentId.in.includes(payment.dailyAssignmentId) ||
              payment.status !== where.status
            ) {
              continue;
            }
            sums.set(
              payment.dailyAssignmentId,
              (sums.get(payment.dailyAssignmentId) ?? new Prisma.Decimal(0)).plus(payment.amount),
            );
          }
          return Promise.resolve(
            [...sums.entries()].map(([dailyAssignmentId, amount]) => ({
              dailyAssignmentId,
              _sum: { amount },
            })),
          );
        },
      ),
    },
  };

  return { client, state };
}

async function buildService(prisma: { client: unknown }) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      OwnershipPlanGeneratorService,
      { provide: PrismaService, useValue: prisma },
      { provide: SchedulerRegistry, useValue: { addCronJob: jest.fn() } },
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
  return moduleRef.get(OwnershipPlanGeneratorService);
}

describe('OwnershipPlanGeneratorService', () => {
  it('DOUBLE RUN: running twice for the same date creates exactly one assignment with an unchanged target', async () => {
    const plan = makePlan({ id: 'plan-1', driverId: 'driver-1', startDate: utc(2026, 8, 3) });
    const { client, state } = createFakePrisma({ plans: [plan] });
    const service = await buildService({ client });

    const today = utc(2026, 8, 3);
    const first = await service.generate(today);
    const second = await service.generate(today);

    expect(first.assignmentsCreated).toBe(1);
    expect(second.assignmentsCreated).toBe(0);
    expect(state.assignments).toHaveLength(1);
    expect(state.assignments[0].targetAmount.toFixed(2)).toBe('12000.00');
  });

  it('FINAL INSTALMENT: 4,000 remaining against a 12,000 daily amount generates a 4,000 assignment', async () => {
    const plan = makePlan({
      id: 'plan-1',
      driverId: 'driver-1',
      totalPrice: new Prisma.Decimal(1_800_000),
      downPayment: new Prisma.Decimal(0),
    });
    const seedAssignment: FakeAssignment = {
      id: 'seed-1',
      tenantId: 'tenant-1',
      driverId: 'driver-1',
      motorcycleId: plan.motorcycleId,
      assignedDate: utc(2026, 8, 3),
      // amountBilled (Part 1) is the sum of targetAmount over ALL assignments,
      // so a fully-current driver's billed history must match what's paid -
      // 1,796,000 billed and paid, 4,000 of the 1,800,000 price left either way.
      targetAmount: new Prisma.Decimal(1_796_000),
      ownershipPlanId: 'plan-1',
      reference: 'BF-SEED0001',
    };
    const { client, state } = createFakePrisma({
      plans: [plan],
      assignments: [seedAssignment],
      payments: [
        {
          dailyAssignmentId: 'seed-1',
          amount: new Prisma.Decimal(1_796_000),
          status: PaymentStatus.COMPLETED,
        },
      ],
    });
    const service = await buildService({ client });

    const result = await service.generate(utc(2026, 8, 4));

    expect(result.assignmentsCreated).toBe(1);
    const created = state.assignments.find((a) => a.id !== 'seed-1');
    expect(created?.targetAmount.toFixed(2)).toBe('4000.00');
    expect(created?.assignedDate.getTime()).toBe(utc(2026, 8, 4).getTime());
  });

  it('COMPLETION: remainingToOwn reaching 0 marks the plan COMPLETED and stops billing it', async () => {
    const plan = makePlan({
      id: 'plan-1',
      driverId: 'driver-1',
      totalPrice: new Prisma.Decimal(1_800_000),
      downPayment: new Prisma.Decimal(0),
    });
    const seedAssignment: FakeAssignment = {
      id: 'seed-1',
      tenantId: 'tenant-1',
      driverId: 'driver-1',
      motorcycleId: plan.motorcycleId,
      assignedDate: utc(2026, 8, 3),
      targetAmount: new Prisma.Decimal(12000),
      ownershipPlanId: 'plan-1',
      reference: 'BF-SEED0002',
    };
    const { client, state } = createFakePrisma({
      plans: [plan],
      assignments: [seedAssignment],
      payments: [
        {
          dailyAssignmentId: 'seed-1',
          amount: new Prisma.Decimal(1_800_000),
          status: PaymentStatus.COMPLETED,
        },
      ],
    });
    const service = await buildService({ client });

    const result = await service.generate(utc(2026, 8, 4));

    expect(result.assignmentsCreated).toBe(0);
    expect(result.plansCompleted).toBe(1);
    expect(plan.status).toBe(OwnershipPlanStatus.COMPLETED);
    expect(plan.completedAt).toEqual(utc(2026, 8, 4));

    // A further run must generate nothing for a COMPLETED plan.
    const again = await service.generate(utc(2026, 8, 5));
    expect(again.plansScanned).toBe(0);
    expect(state.assignments).toHaveLength(1);
  });

  describe('Part 1: remainingToBill caps arrears at the price of the vehicle', () => {
    it('4,000 remaining, 12,000/day, driver pays nothing: 10 consecutive days bill 4,000 total in ONE assignment', async () => {
      const plan = makePlan({
        id: 'plan-1',
        driverId: 'driver-1',
        totalPrice: new Prisma.Decimal(4000),
        downPayment: new Prisma.Decimal(0),
        startDate: utc(2026, 8, 3),
      });
      const { client, state } = createFakePrisma({ plans: [plan] });
      const service = await buildService({ client });

      let totalCreated = 0;
      for (let day = 0; day < 10; day += 1) {
        const result = await service.generate(addDays(utc(2026, 8, 3), day));
        totalCreated += result.assignmentsCreated;
      }

      expect(state.assignments).toHaveLength(1);
      const totalBilled = state.assignments.reduce(
        (sum, a) => sum.plus(a.targetAmount),
        new Prisma.Decimal(0),
      );
      expect(totalBilled.toFixed(2)).toBe('4000.00');
      expect(totalCreated).toBe(1);
      // The plan stays ACTIVE throughout - it is unpaid, not finished.
      expect(plan.status).toBe(OwnershipPlanStatus.ACTIVE);
    });

    it('arrears (daysBehind) stop growing once billing is capped, rather than climbing forever', async () => {
      const plan = makePlan({
        id: 'plan-1',
        driverId: 'driver-1',
        totalPrice: new Prisma.Decimal(4000),
        downPayment: new Prisma.Decimal(0),
        startDate: utc(2026, 8, 3),
      });
      const { client, state } = createFakePrisma({ plans: [plan] });
      const service = await buildService({ client });

      for (let day = 0; day < 10; day += 1) {
        await service.generate(addDays(utc(2026, 8, 3), day));
      }

      // netPosition = amountPaid(0) - amountDue(sum of targetAmount to date).
      // amountDue is capped at 4,000 forever (only one row was ever billed),
      // so daysBehind = ceil(4000/12000) = 1, not 10 and not climbing.
      const amountDue = state.assignments.reduce(
        (sum, a) => sum.plus(a.targetAmount),
        new Prisma.Decimal(0),
      );
      expect(amountDue.toFixed(2)).toBe('4000.00');
    });

    it('backfill of 3 days on a 20,000-remaining, 12,000/day plan bills 12,000 then 8,000 then nothing, in one run', async () => {
      const plan = makePlan({
        id: 'plan-1',
        driverId: 'driver-1',
        totalPrice: new Prisma.Decimal(20000),
        downPayment: new Prisma.Decimal(0),
        startDate: utc(2026, 8, 3), // Mon
      });
      const { client, state } = createFakePrisma({ plans: [plan] });
      const service = await buildService({ client });

      // Server "down" until 2026-08-05 (Wed) - 3 missed active weekdays in one run.
      const result = await service.generate(utc(2026, 8, 5));

      expect(result.assignmentsCreated).toBe(2);
      const byDate = new Map(
        state.assignments.map((a) => [a.assignedDate.toISOString().slice(0, 10), a.targetAmount]),
      );
      expect(byDate.get('2026-08-03')?.toFixed(2)).toBe('12000.00');
      expect(byDate.get('2026-08-04')?.toFixed(2)).toBe('8000.00');
      expect(byDate.has('2026-08-05')).toBe(false); // "then nothing" - the third day is not created.
      expect(plan.status).toBe(OwnershipPlanStatus.ACTIVE); // billed out, not paid off.
    });

    it('fully billed but unpaid stays ACTIVE, and paying it off then marks it COMPLETED', async () => {
      const plan = makePlan({
        id: 'plan-1',
        driverId: 'driver-1',
        totalPrice: new Prisma.Decimal(20000),
        downPayment: new Prisma.Decimal(0),
        startDate: utc(2026, 8, 3),
      });
      const { client, state } = createFakePrisma({ plans: [plan] });
      const service = await buildService({ client });

      await service.generate(utc(2026, 8, 5)); // bills 12,000 + 8,000 = fully billed.
      expect(plan.status).toBe(OwnershipPlanStatus.ACTIVE);
      expect(state.assignments).toHaveLength(2);

      // Driver pays it all off.
      for (const a of state.assignments) {
        state.payments.push({
          dailyAssignmentId: a.id,
          amount: a.targetAmount,
          status: PaymentStatus.COMPLETED,
        });
      }

      const result = await service.generate(utc(2026, 8, 6));
      expect(result.plansCompleted).toBe(1);
      expect(plan.status).toBe(OwnershipPlanStatus.COMPLETED);
      expect(plan.completedAt).toEqual(utc(2026, 8, 6));
    });
  });

  it('SUNDAY: a plan excluding Sunday generates nothing on Sunday and generates normally on Monday', async () => {
    // 2026-08-02 is a Sunday, 2026-08-03 is a Monday.
    const plan = makePlan({
      id: 'plan-1',
      driverId: 'driver-1',
      startDate: utc(2026, 8, 2),
      activeWeekdays: [1, 2, 3, 4, 5, 6],
    });
    const { client, state } = createFakePrisma({ plans: [plan] });
    const service = await buildService({ client });

    const sunday = await service.generate(utc(2026, 8, 2));
    expect(sunday.assignmentsCreated).toBe(0);
    expect(state.assignments).toHaveLength(0);

    const monday = await service.generate(utc(2026, 8, 3));
    expect(monday.assignmentsCreated).toBe(1);
    expect(state.assignments[0].assignedDate.getTime()).toBe(utc(2026, 8, 3).getTime());
  });

  it('BACKFILL: three missed active weekdays produce three assignments on their own correct dates', async () => {
    const plan = makePlan({ id: 'plan-1', driverId: 'driver-1', startDate: utc(2026, 8, 3) });
    const { client, state } = createFakePrisma({ plans: [plan] });
    const service = await buildService({ client });

    // Server "down" until 2026-08-05: startDate Mon 8/3, first run on Wed 8/5.
    const result = await service.generate(utc(2026, 8, 5));

    expect(result.assignmentsCreated).toBe(3);
    const dates = state.assignments.map((a) => a.assignedDate.toISOString().slice(0, 10)).sort();
    expect(dates).toEqual(['2026-08-03', '2026-08-04', '2026-08-05']);
    // Distinct rows, not one merged row and not three stacked on today.
    expect(new Set(dates).size).toBe(3);
  });

  it('BACKFILL BOUND: a gap longer than the lookback is not backfilled beyond it and is surfaced', async () => {
    // Lookback default is 14 days; start the plan 20 days before "today".
    const today = utc(2026, 8, 20);
    const plan = makePlan({ id: 'plan-1', driverId: 'driver-1', startDate: utc(2026, 7, 31) });
    const { client, state } = createFakePrisma({ plans: [plan] });
    const service = await buildService({ client });

    const result = await service.generate(today);

    expect(result.unbackfilledGaps).toHaveLength(1);
    expect(result.unbackfilledGaps[0]).toMatchObject({ planId: 'plan-1', driverId: 'driver-1' });
    expect(result.unbackfilledGaps[0].missedActiveWeekdays).toBeGreaterThan(0);

    const windowStart = utc(2026, 8, 6); // today - 14 days
    const tooOld = state.assignments.some((a) => a.assignedDate.getTime() < windowStart.getTime());
    expect(tooOld).toBe(false);
  });

  it('TENANT ISOLATION: a failure in one tenant does not prevent another tenant from generating', async () => {
    const planOk = makePlan({
      id: 'plan-ok',
      driverId: 'driver-ok',
      tenantId: 'tenant-ok',
      startDate: utc(2026, 8, 3),
    });
    const planFail = makePlan({
      id: 'plan-fail',
      driverId: 'driver-fail',
      tenantId: 'tenant-fail',
      startDate: utc(2026, 8, 3),
    });
    const { client, state } = createFakePrisma({
      plans: [planOk, planFail],
      tenants: [
        { id: 'tenant-ok', name: 'OK Fleet', isActive: true },
        { id: 'tenant-fail', name: 'Fail Fleet', isActive: true },
      ],
      failingTenantId: 'tenant-fail',
    });
    const service = await buildService({ client });

    const result = await service.generate(utc(2026, 8, 3));

    expect(result.tenantsScanned).toBe(2);
    expect(result.assignmentsCreated).toBe(1);
    expect(state.assignments).toHaveLength(1);
    expect(state.assignments[0].tenantId).toBe('tenant-ok');
  });

  it('does not violate the unique driver+date constraint when a manual assignment already exists, and reports it as blocked', async () => {
    const plan = makePlan({ id: 'plan-1', driverId: 'driver-1', startDate: utc(2026, 8, 3) });
    const manualAssignment: FakeAssignment = {
      id: 'manual-1',
      tenantId: 'tenant-1',
      driverId: 'driver-1',
      motorcycleId: plan.motorcycleId,
      assignedDate: utc(2026, 8, 3),
      targetAmount: new Prisma.Decimal(5000),
      ownershipPlanId: null,
      reference: 'BF-MANUAL01',
    };
    const { client, state } = createFakePrisma({ plans: [plan], assignments: [manualAssignment] });
    const service = await buildService({ client });

    const result = await service.generate(utc(2026, 8, 3));

    expect(result.assignmentsCreated).toBe(0);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]).toMatchObject({
      planId: 'plan-1',
      driverId: 'driver-1',
      assignedDate: '2026-08-03',
    });
    // The manual row is untouched - not converted into a plan instalment.
    expect(state.assignments).toHaveLength(1);
    expect(state.assignments[0].id).toBe('manual-1');
    expect(state.assignments[0].ownershipPlanId).toBeNull();
  });

  it('does not self-schedule a cron job in the test environment', async () => {
    const { client } = createFakePrisma({ plans: [] });
    const schedulerRegistry = { addCronJob: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        OwnershipPlanGeneratorService,
        { provide: PrismaService, useValue: { client } },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) =>
              key === 'NODE_ENV' ? 'test' : fallback,
            ),
          },
        },
      ],
    }).compile();
    moduleRef.get(OwnershipPlanGeneratorService).onModuleInit();
    expect(schedulerRegistry.addCronJob).not.toHaveBeenCalled();
  });
});
