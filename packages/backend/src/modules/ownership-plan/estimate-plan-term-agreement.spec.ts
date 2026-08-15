/**
 * Stage G Part 1, carried forward by Stage G7 - the same invariant Stage F3c
 * used for the contract total: agreement with the biller, not a
 * hand-computed number. estimatePlanTerm() (shared-lib, also used by the
 * dashboard's create-plan form) must produce a days/total/calendarEndDate
 * that agrees with what the real Stage E nightly generator
 * (OwnershipPlanGeneratorService) actually produces for that plan, run to
 * completion - not a second, independently hand-computed formula that could
 * quietly drift from the real one.
 *
 * Stage G7 rewrote estimatePlanTerm to work in both directions (days ->
 * total, exact always; total -> days, exact when it divides evenly,
 * otherwise two neighbouring whole-day options) and dropped
 * totalPrice/downPayment/finalInstalment entirely - totalOwed is now
 * dailyAmount x instalmentCount, so there is no remainder left for either
 * side to disagree about.
 *
 * The fake Prisma harness below is the same trimmed shape used in
 * ownership-plan-contract-total-agreement.spec.ts, kept local per that
 * file's own precedent rather than shared.
 */
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { OwnershipPlanStatus, Prisma } from '@prisma/client';
import { estimatePlanTerm } from '@bongofleet/shared-lib';
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

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface FakePlan {
  id: string;
  tenantId: string;
  driverId: string;
  motorcycleId: string;
  dailyAmount: Prisma.Decimal;
  instalmentCount: number;
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

function createFakePrisma(plan: FakePlan) {
  const state = { plans: [plan], assignments: [] as FakeAssignment[] };
  let idCounter = 0;

  const client = {
    tenant: {
      findMany: jest.fn(() =>
        Promise.resolve([{ id: plan.tenantId, name: 'tenant', isActive: true }]),
      ),
    },
    ownershipPlan: {
      findMany: jest.fn(
        ({ where }: { where: { tenantId: string; status?: OwnershipPlanStatus } }) =>
          Promise.resolve(
            state.plans
              .filter(
                (p) =>
                  p.tenantId === where.tenantId && (!where.status || p.status === where.status),
              )
              .map((p) => ({ ...p })),
          ),
      ),
      updateMany: jest.fn(
        ({ where, data }: { where: { id: { in: string[] } }; data: Partial<FakePlan> }) => {
          let count = 0;
          for (const p of state.plans) {
            if (where.id.in.includes(p.id)) {
              Object.assign(p, data);
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
      // remainingToBill (the generator's real billing cap) depends only on
      // amountBilled, never on amountPaid - a plan can be billed to
      // completion here without ever seeding a payment.
      groupBy: jest.fn(() => Promise.resolve([])),
    },
  };

  return { client, state };
}

async function buildService(prisma: { client: unknown }): Promise<OwnershipPlanGeneratorService> {
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

async function billToCompletion(
  service: OwnershipPlanGeneratorService,
  plan: FakePlan,
  state: { assignments: FakeAssignment[] },
): Promise<void> {
  let cursor = plan.startDate;
  const hardStop = addDays(plan.startDate, 500); // safety net; must exceed the largest instalmentCount tested (430)
  for (
    let quietDays = 0;
    quietDays < 2 && cursor.getTime() < hardStop.getTime();
    cursor = addDays(cursor, 1)
  ) {
    const before = state.assignments.length;
    await service.generate(cursor);
    quietDays = state.assignments.length > before ? 0 : quietDays + 1;
  }
}

describe('estimatePlanTerm agrees with the Stage E daily-charge generator (Stage G7)', () => {
  it.each<[string, number, number, number[]]>([
    ['every day active', 12_000, 150, [0, 1, 2, 3, 4, 5, 6]],
    ['Sunday skipped', 12_000, 150, [1, 2, 3, 4, 5, 6]],
    ["Ibrahim's own worked example", 12_000, 430, [0, 1, 2, 3, 4, 5, 6]],
  ])('days -> total: %s', async (_label, dailyAmount, instalmentCount, activeWeekdays) => {
    const startDate = utc(2026, 8, 3); // a Monday
    const plan: FakePlan = {
      id: 'plan-1',
      tenantId: 'tenant-1',
      driverId: 'driver-1',
      motorcycleId: 'veh-1',
      dailyAmount: new Prisma.Decimal(dailyAmount),
      instalmentCount,
      startDate,
      activeWeekdays,
      status: OwnershipPlanStatus.ACTIVE,
      completedAt: null,
    };
    const { client, state } = createFakePrisma(plan);
    const service = await buildService({ client });

    await billToCompletion(service, plan, state);

    const byDate = [...state.assignments].sort(
      (a, b) => a.assignedDate.getTime() - b.assignedDate.getTime(),
    );
    const lastAssignment = byDate[byDate.length - 1];
    const billedSum = byDate.reduce((sum, a) => sum.plus(a.targetAmount), new Prisma.Decimal(0));

    const estimate = estimatePlanTerm({
      dailyAmount,
      days: instalmentCount,
      startDate: isoDate(startDate),
      activeWeekdays,
    });

    expect(estimate.exact).toBe(true);
    if (!estimate.exact) return; // narrows the type for TS; unreachable given the assertion above
    expect(estimate.days).toBe(byDate.length);
    expect(estimate.total).toBe(billedSum.toNumber());
    expect(estimate.calendarEndDate).toBe(isoDate(lastAssignment.assignedDate));

    // Every charge the generator actually created is a full instalment - the
    // fact the "days -> total" direction can print, by construction.
    for (const a of byDate) {
      expect(a.targetAmount.toFixed(2)).toBe(dailyAmount.toFixed(2));
    }
  });

  it.each<[string, number, number, number[]]>([
    ['every day active', 12_000, 150, [0, 1, 2, 3, 4, 5, 6]],
    ['Sunday skipped', 12_000, 150, [1, 2, 3, 4, 5, 6]],
  ])(
    'total -> days, exact division: %s',
    async (_label, dailyAmount, instalmentCount, activeWeekdays) => {
      const startDate = utc(2026, 8, 3);
      const plan: FakePlan = {
        id: 'plan-1',
        tenantId: 'tenant-1',
        driverId: 'driver-1',
        motorcycleId: 'veh-1',
        dailyAmount: new Prisma.Decimal(dailyAmount),
        instalmentCount,
        startDate,
        activeWeekdays,
        status: OwnershipPlanStatus.ACTIVE,
        completedAt: null,
      };
      const { client, state } = createFakePrisma(plan);
      const service = await buildService({ client });

      await billToCompletion(service, plan, state);

      const byDate = [...state.assignments].sort(
        (a, b) => a.assignedDate.getTime() - b.assignedDate.getTime(),
      );
      const lastAssignment = byDate[byDate.length - 1];

      const estimate = estimatePlanTerm({
        dailyAmount,
        total: dailyAmount * instalmentCount,
        startDate: isoDate(startDate),
        activeWeekdays,
      });

      expect(estimate.exact).toBe(true);
      if (!estimate.exact) return;
      expect(estimate.days).toBe(byDate.length);
      expect(estimate.calendarEndDate).toBe(isoDate(lastAssignment.assignedDate));
    },
  );

  it('total -> days, non-dividing total: returns two neighbouring whole-day options, not a rounded figure', () => {
    // 1,000,000 / 12,000 = 83.33 - does not divide evenly.
    const estimate = estimatePlanTerm({
      dailyAmount: 12_000,
      total: 1_000_000,
      startDate: '2026-08-03',
      activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
    });

    expect(estimate.exact).toBe(false);
    if (estimate.exact) return;
    const [lower, upper] = estimate.options;
    expect(lower.days).toBe(83);
    expect(lower.total).toBe(996_000);
    expect(upper.days).toBe(84);
    expect(upper.total).toBe(1_008_000);
    // Both totals are exact multiples of dailyAmount - neither is the
    // requested (non-dividing) total itself.
    expect(lower.total % 12_000).toBe(0);
    expect(upper.total % 12_000).toBe(0);
  });

  it('returns zero days/total for zero days requested, rather than a negative or NaN result', () => {
    const estimate = estimatePlanTerm({
      dailyAmount: 12_000,
      days: 0,
      startDate: '2026-08-03',
      activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
    });

    expect(estimate.exact).toBe(true);
    if (!estimate.exact) return;
    expect(estimate.days).toBe(0);
    expect(estimate.total).toBe(0);
    expect(estimate.calendarEndDate).toBe('2026-08-03');
  });

  it('returns zero days/total for a total of zero, rather than dividing by it', () => {
    const estimate = estimatePlanTerm({
      dailyAmount: 12_000,
      total: 0,
      startDate: '2026-08-03',
      activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
    });

    expect(estimate.exact).toBe(true);
    if (!estimate.exact) return;
    expect(estimate.days).toBe(0);
    expect(estimate.total).toBe(0);
    expect(estimate.calendarEndDate).toBe('2026-08-03');
  });
});
