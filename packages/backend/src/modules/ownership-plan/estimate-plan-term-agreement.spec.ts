/**
 * Stage G Part 1 - the same invariant Stage F3c used for the contract total:
 * agreement with the biller, not a hand-computed number. estimatePlanTerm()
 * (shared-lib, also used by the dashboard's create-plan form) must produce a
 * paymentDayCount, finalInstalment, and calendarEndDate that agree with what
 * the real Stage E nightly generator (OwnershipPlanGeneratorService) actually
 * produces for that plan, run to completion - not a second, independently
 * hand-computed formula that could quietly drift from the real one.
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
  const hardStop = addDays(plan.startDate, 400);
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

describe('estimatePlanTerm agrees with the Stage E daily-charge generator (Stage G Part 1)', () => {
  it.each<[string, number, number, number, number[]]>([
    ['exact multiple, every day active', 1_800_000, 0, 12_000, [0, 1, 2, 3, 4, 5, 6]],
    ['non-multiple, every day active', 1_800_000, 200_000, 12_000, [0, 1, 2, 3, 4, 5, 6]],
    ['non-multiple, Sunday skipped', 1_800_000, 191_500, 12_000, [1, 2, 3, 4, 5, 6]],
  ])('%s', async (_label, totalPrice, downPayment, dailyAmount, activeWeekdays) => {
    const startDate = utc(2026, 8, 3); // a Monday
    const plan: FakePlan = {
      id: 'plan-1',
      tenantId: 'tenant-1',
      driverId: 'driver-1',
      motorcycleId: 'veh-1',
      dailyAmount: new Prisma.Decimal(dailyAmount),
      totalPrice: new Prisma.Decimal(totalPrice),
      downPayment: new Prisma.Decimal(downPayment),
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
      totalPrice,
      downPayment,
      dailyAmount,
      startDate: isoDate(startDate),
      activeWeekdays,
    });

    expect(estimate.paymentDayCount).toBe(byDate.length);
    expect(estimate.calendarEndDate).toBe(isoDate(lastAssignment.assignedDate));

    const totalOwed = totalPrice - downPayment;
    const isExactMultiple = totalOwed % dailyAmount === 0;
    if (isExactMultiple) {
      expect(estimate.finalInstalment).toBe(0);
      expect(lastAssignment.targetAmount.toFixed(2)).toBe(dailyAmount.toFixed(2));
    } else {
      expect(estimate.finalInstalment).toBeGreaterThan(0);
      expect(lastAssignment.targetAmount.toFixed(2)).toBe(estimate.finalInstalment.toFixed(2));
    }
  });

  it('returns zero days/instalment for a totalOwed of zero, rather than dividing by it', () => {
    const estimate = estimatePlanTerm({
      totalPrice: 1_800_000,
      downPayment: 1_800_000,
      dailyAmount: 12_000,
      startDate: '2026-08-03',
      activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
    });

    expect(estimate.paymentDayCount).toBe(0);
    expect(estimate.finalInstalment).toBe(0);
    expect(estimate.calendarEndDate).toBe('2026-08-03');
  });
});
