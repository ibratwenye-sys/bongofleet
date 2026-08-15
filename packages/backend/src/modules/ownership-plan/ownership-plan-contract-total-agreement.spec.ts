/**
 * Stage F3c Part 3 - the strongest test for the contract's total repayment
 * sentence is not a hand-computed number: it is agreement with the biller.
 * This asserts that the total figure actually PRINTED on the contract (read
 * back out of the real rendered text, not re-derived from the same formula
 * the renderer itself uses) equals the sum of the charges the real Stage E
 * nightly generator (OwnershipPlanGeneratorService) actually produces for
 * that exact plan, run to completion against a fake-but-faithful Prisma
 * client. Two independent code paths; if either one drifts from the other,
 * this fails - whichever side moved.
 *
 * The fake Prisma harness below is a trimmed copy of the one in
 * ownership-plan-generator.service.spec.ts, kept local rather than shared
 * because this file only needs the single-tenant, single-plan, no-payments
 * shape (remainingToBill - which caps billing - depends only on amountBilled,
 * never on amountPaid, so a plan can be billed to completion here without
 * ever seeding a payment).
 */
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { OwnershipPlanStatus, Prisma, PaymentAccountKind } from '@prisma/client';
import { OwnershipPlanGeneratorService } from './ownership-plan-generator.service';
import { PrismaService } from '../../prisma/prisma.service';
import { contractTextPairs, ContractContext } from './ownership-plan-contract.pdf';

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
      // No payments ever seeded - remainingToBill (the generator's actual
      // billing cap) depends only on amountBilled, never on amountPaid.
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

/** Runs the real generator day by day (activeWeekdays here is every day, so
 *  this is exactly one call per calendar day) until a full day passes with
 *  no new assignment created - i.e. the plan is billed to completion, the
 *  same end state the real nightly cron reaches over enough real nights. */
async function billToCompletion(
  service: OwnershipPlanGeneratorService,
  plan: FakePlan,
  state: { assignments: FakeAssignment[] },
): Promise<void> {
  let cursor = plan.startDate;
  const hardStop = addDays(plan.startDate, 500); // safety net against an infinite loop on a real bug; must exceed the largest instalmentCount tested (430)
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

function extractPrintedTotal(ctx: ContractContext): string {
  const pairs = contractTextPairs(ctx);
  const totalPair = pairs.find((p) => p.en.includes('The total of all remittances'));
  if (!totalPair) {
    throw new Error('No total-repayment sentence found in the rendered contract');
  }
  const match = /Tanzanian shillings ([\d,]+)\/=/.exec(totalPair.en);
  if (!match) {
    throw new Error(`Could not parse a total out of: ${totalPair.en}`);
  }
  return match[1].replace(/,/g, '');
}

const BASE_CONTEXT: Omit<ContractContext, 'plan'> = {
  renderedAt: new Date('2026-08-01T00:00:00.000Z'),
  tenant: {
    name: 'Mfano Fleet Ltd',
    physicalAddress: 'Kariakoo, Dar es Salaam',
    directorName: 'Amina Said',
  },
  driver: {
    fullName: 'Juma Hassan',
    nationalId: '00000000-00000-00000-00',
    residenceWard: 'Kariakoo',
    residenceDistrict: 'Ilala',
    residenceRegion: 'Dar es Salaam',
  },
  vehicle: {
    registrationNumber: 'T 456 DEF',
    chassisNumber: 'MH1JF5011KK098765',
    make: 'TVS',
    model: 'HLX 125',
    colour: 'Nyekundu',
  },
  guarantor: null,
  paymentAccounts: [
    {
      kind: PaymentAccountKind.LIPA_NUMBER,
      provider: 'Azam Pesa',
      accountNumber: '000000',
      accountName: null,
    },
  ],
};

describe('Contract total repayment sentence agrees with the Stage E daily-charge generator (Stage G7)', () => {
  it.each<[string, number, number]>([
    // [label, instalmentCount, dailyAmount]
    ['short term (SPARSE-style: 150 x 12,000 = 1,800,000)', 150, 12_000],
    ['mid term (FULL-style: 100 x 12,000 = 1,200,000)', 100, 12_000],
    ["Ibrahim's own worked example (LARGE-style: 430 x 12,000 = 5,160,000)", 430, 12_000],
  ])('%s', async (_label, instalmentCount, dailyAmount) => {
    const plan: FakePlan = {
      id: 'plan-1',
      tenantId: 'tenant-1',
      driverId: 'driver-1',
      motorcycleId: 'veh-1',
      dailyAmount: new Prisma.Decimal(dailyAmount),
      instalmentCount,
      startDate: utc(2026, 8, 3),
      activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
      status: OwnershipPlanStatus.ACTIVE,
      completedAt: null,
    };
    const { client, state } = createFakePrisma(plan);
    const service = await buildService({ client });

    await billToCompletion(service, plan, state);

    const billedSum = state.assignments.reduce(
      (sum, a) => sum.plus(a.targetAmount),
      new Prisma.Decimal(0),
    );

    const ctx: ContractContext = {
      ...BASE_CONTEXT,
      plan: {
        agreementDate: new Date('2026-03-01T00:00:00.000Z'),
        // Declared value/deposit are decorative now (Stage G7) - deliberately
        // unrelated to instalmentCount x dailyAmount, to prove the total
        // sentence never reads them.
        totalPrice: new Prisma.Decimal(999_999),
        downPayment: new Prisma.Decimal(1_234),
        dailyAmount: new Prisma.Decimal(dailyAmount),
        instalmentCount,
        startDate: utc(2026, 8, 3),
        contractEndDate: null,
        lateFeeAmount: null,
        breachAfterConsecutiveMissedDays: 5,
      },
    };
    const printedTotal = extractPrintedTotal(ctx);

    expect(printedTotal).toBe(billedSum.toFixed(0));
  });
});
