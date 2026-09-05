import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { ExpenseStatus, Prisma, UserRole } from '@prisma/client';
import {
  deriveDuplicateFlags,
  deriveOverCapFlags,
  ExpenseAdvisoryCandidate,
  ExpenseService,
} from './expense.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

function decimal(value: number | string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function candidate(overrides: Partial<ExpenseAdvisoryCandidate> = {}): ExpenseAdvisoryCandidate {
  return {
    id: 'expense-1',
    submittedByRiderId: 'driver-1',
    category: 'Fuel',
    amount: decimal(1000),
    incurredAt: new Date('2026-09-04T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ExpenseService', () => {
  let service: ExpenseService;
  let prisma: {
    client: {
      driver: { findUnique: jest.Mock };
      transportJob: { findMany: jest.Mock };
      expense: { create: jest.Mock; findMany: jest.Mock; groupBy: jest.Mock };
      expenseCategoryCap: { findMany: jest.Mock };
    };
  };

  const driverActor: AuthenticatedUser = {
    userId: 'user-driver',
    tenantId: 'tenant-1',
    role: UserRole.RIDER,
    email: 'driver@example.com',
    firstName: 'Juma',
    lastName: 'Hassan',
    jti: 'jti-driver',
  };

  beforeEach(async () => {
    prisma = {
      client: {
        driver: { findUnique: jest.fn().mockResolvedValue({ id: 'driver-1' }) },
        transportJob: { findMany: jest.fn() },
        expense: {
          create: jest
            .fn()
            .mockImplementation(({ data }) => Promise.resolve({ id: 'expense-1', ...data })),
          findMany: jest.fn().mockResolvedValue([]),
          groupBy: jest.fn().mockResolvedValue([]),
        },
        expenseCategoryCap: { findMany: jest.fn().mockResolvedValue([]) },
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExpenseService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => './uploads' } },
      ],
    }).compile();
    service = moduleRef.get(ExpenseService);
  });

  const dto = { category: 'Fuel', amount: 5000, incurredAt: '2026-09-04' };

  describe('submitForJob', () => {
    it('resolves to the single IN_TRANSIT job', async () => {
      prisma.client.transportJob.findMany.mockResolvedValueOnce([
        { id: 'job-1', motorcycleId: 'veh-1' },
      ]);

      const result = await service.submitForJob(dto, driverActor);

      expect(result.transportJobId).toBe('job-1');
      expect(result.motorcycleId).toBe('veh-1');
      expect(result.dailyAssignmentId).toBeUndefined();
      expect(result.status).toBe(ExpenseStatus.PENDING);
      expect(result.submittedByRiderId).toBe('driver-1');
      expect(result.submittedByUserId).toBe('user-driver');
      // Only the IN_TRANSIT query ran - never fell through to SCHEDULED.
      expect(prisma.client.transportJob.findMany).toHaveBeenCalledTimes(1);
    });

    it('falls back to the soonest SCHEDULED job (scheduledDate asc, createdAt asc) when there is no IN_TRANSIT one', async () => {
      prisma.client.transportJob.findMany
        .mockResolvedValueOnce([]) // IN_TRANSIT query
        .mockResolvedValueOnce([{ id: 'job-2', motorcycleId: 'veh-2' }]); // SCHEDULED query

      const result = await service.submitForJob(dto, driverActor);

      expect(result.transportJobId).toBe('job-2');
      expect(result.motorcycleId).toBe('veh-2');
      const scheduledCallArgs = prisma.client.transportJob.findMany.mock.calls[1][0];
      expect(scheduledCallArgs.orderBy).toEqual([{ scheduledDate: 'asc' }, { createdAt: 'asc' }]);
      expect(scheduledCallArgs.take).toBe(1);
    });

    it('throws "no active or upcoming job" when there is neither an IN_TRANSIT nor a SCHEDULED job', async () => {
      prisma.client.transportJob.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await expect(service.submitForJob(dto, driverActor)).rejects.toThrow(
        new BadRequestException('You have no active or upcoming job right now.'),
      );
      expect(prisma.client.expense.create).not.toHaveBeenCalled();
    });

    it('throws the ambiguity error when more than one job is IN_TRANSIT, without guessing', async () => {
      prisma.client.transportJob.findMany.mockResolvedValueOnce([
        { id: 'job-1', motorcycleId: 'veh-1' },
        { id: 'job-2', motorcycleId: 'veh-2' },
      ]);

      await expect(service.submitForJob(dto, driverActor)).rejects.toThrow(
        new BadRequestException(
          "You have more than one active job right now - this isn't supported yet.",
        ),
      );
      expect(prisma.client.expense.create).not.toHaveBeenCalled();
    });
  });

  describe('deriveOverCapFlags / deriveDuplicateFlags (pure, DB-free)', () => {
    it("a single claim under the cap is not flagged over-cap, and isn't a duplicate of anything", () => {
      const c = candidate({ amount: decimal(1000) });
      const capByCategory = new Map([['Fuel', decimal(5000)]]);
      const sumByTriple = new Map([[tripleKeyForTest(c), decimal(1000)]]);
      const idsByTuple = new Map([[tupleKeyForTest(c), [c.id]]]); // only itself matches

      expect(deriveOverCapFlags([c], capByCategory, sumByTriple).get(c.id)).toBe(false);
      expect(deriveDuplicateFlags([c], idsByTuple).get(c.id)).toBe(false);
    });

    it('several small same-day same-category claims that sum over the cap are flagged - proves the running-total behaviour, not a single-claim check', () => {
      // Three PENDING claims of 2000 each, same rider/category/date -
      // individually all under a 5000 cap, but their running total (which
      // sumByTriple represents, already summed across all of them by the
      // caller) is 6000 > 5000.
      const day = new Date('2026-09-04T00:00:00.000Z');
      const claims = [
        candidate({ id: 'e1', amount: decimal(2000), incurredAt: day }),
        candidate({ id: 'e2', amount: decimal(2000), incurredAt: day }),
        candidate({ id: 'e3', amount: decimal(2000), incurredAt: day }),
      ];
      const capByCategory = new Map([['Fuel', decimal(5000)]]);
      const sumByTriple = new Map([[tripleKeyForTest(claims[0]), decimal(6000)]]);

      const flags = deriveOverCapFlags(claims, capByCategory, sumByTriple);
      expect(flags.get('e1')).toBe(true);
      expect(flags.get('e2')).toBe(true);
      expect(flags.get('e3')).toBe(true);
    });

    it('a claim in a category with no configured cap is never flagged', () => {
      const c = candidate({ category: 'Wash' });
      // capByCategory has no 'Wash' entry at all - Fuel only.
      const capByCategory = new Map([['Fuel', decimal(5000)]]);
      const sumByTriple = new Map<string, Prisma.Decimal>();

      expect(deriveOverCapFlags([c], capByCategory, sumByTriple).get(c.id)).toBeUndefined();
    });

    it('an exact duplicate across two DIFFERENT riders is not flagged - the tuple must match on riderId too', () => {
      const a = candidate({ id: 'e-a', submittedByRiderId: 'driver-A' });
      const b = candidate({ id: 'e-b', submittedByRiderId: 'driver-B' });
      // Same category/amount/incurredAt, but distinct tuples because the
      // riderId differs - idsByTuple below reflects that (each tuple maps
      // to only its own single id), same as a real findMany result would.
      const idsByTuple = new Map([
        [tupleKeyForTest(a), ['e-a']],
        [tupleKeyForTest(b), ['e-b']],
      ]);

      const flags = deriveDuplicateFlags([a, b], idsByTuple);
      expect(flags.get('e-a')).toBe(false);
      expect(flags.get('e-b')).toBe(false);
    });

    it('a REJECTED prior claim is excluded from the over-cap sum but still counted as a possible duplicate', () => {
      const day = new Date('2026-09-04T00:00:00.000Z');
      const resubmission = candidate({ id: 'e-new', amount: decimal(1000), incurredAt: day });

      // Over-cap: sumByTriple represents "any status except REJECTED" -
      // the caller never included the rejected 1000 in this sum, so the
      // running total is just this one resubmission's own 1000, under a
      // 5000 cap.
      const capByCategory = new Map([['Fuel', decimal(5000)]]);
      const sumByTriple = new Map([[tripleKeyForTest(resubmission), decimal(1000)]]);
      expect(deriveOverCapFlags([resubmission], capByCategory, sumByTriple).get('e-new')).toBe(
        false,
      );

      // Duplicate check: idsByTuple DOES include the earlier REJECTED
      // row's id (that query has no status filter at all) - two ids share
      // the tuple, so this resubmission is flagged.
      const idsByTuple = new Map([[tupleKeyForTest(resubmission), ['e-rejected-old', 'e-new']]]);
      expect(deriveDuplicateFlags([resubmission], idsByTuple).get('e-new')).toBe(true);
    });
  });

  describe('list - advisory flags, batched queries (status=PENDING only)', () => {
    const ownerActor: AuthenticatedUser = {
      userId: 'user-owner',
      tenantId: 'tenant-1',
      role: UserRole.OWNER,
      email: 'owner@example.com',
      firstName: 'O',
      lastName: 'Wner',
      jti: 'jti-owner',
    };

    function pendingRow(overrides: Partial<ExpenseAdvisoryCandidate> = {}) {
      return {
        status: ExpenseStatus.PENDING,
        motorcycleId: 'veh-1',
        ...candidate(overrides),
      };
    }

    it('computes no flags when nothing has a configured cap and no duplicate matches exist, and skips the over-cap sum query entirely (the duplicate-check query still runs once)', async () => {
      prisma.client.expense.findMany
        .mockResolvedValueOnce([pendingRow({ id: 'e1' })]) // the main list query
        .mockResolvedValueOnce([]); // the duplicate-check findMany
      prisma.client.expenseCategoryCap.findMany.mockResolvedValue([]); // no caps configured

      const result = (await service.list(
        { status: ExpenseStatus.PENDING } as never,
        ownerActor,
      )) as unknown as Array<{ overCapFlag: boolean; possibleDuplicateFlag: boolean }>;

      expect(result[0].overCapFlag).toBe(false);
      expect(result[0].possibleDuplicateFlag).toBe(false);
      expect(prisma.client.expenseCategoryCap.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.client.expense.groupBy).not.toHaveBeenCalled(); // skipped - nothing capped
      // The duplicate-check query still runs (it doesn't depend on caps at
      // all) - main list query + duplicate-check query = 2 total.
      expect(prisma.client.expense.findMany).toHaveBeenCalledTimes(2);
    });

    it('the over-cap sum query and the duplicate-check query are each made exactly once, regardless of how many PENDING rows are being evaluated', async () => {
      const day = new Date('2026-09-04T00:00:00.000Z');
      const rows = Array.from({ length: 25 }, (_, i) =>
        pendingRow({ id: `e${i}`, incurredAt: day }),
      );
      prisma.client.expense.findMany
        .mockResolvedValueOnce(rows) // main list query
        .mockResolvedValueOnce([]); // duplicate-check findMany
      prisma.client.expenseCategoryCap.findMany.mockResolvedValue([
        { category: 'Fuel', dailyCapAmount: decimal(100000) },
      ]);
      prisma.client.expense.groupBy.mockResolvedValue([
        {
          submittedByRiderId: 'driver-1',
          category: 'Fuel',
          incurredAt: day,
          _sum: { amount: decimal(25000) },
        },
      ]);

      await service.list({ status: ExpenseStatus.PENDING } as never, ownerActor);

      // Exactly one query per flag's lookup - not one per row, for 25 rows.
      expect(prisma.client.expenseCategoryCap.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.client.expense.groupBy).toHaveBeenCalledTimes(1);
      // expense.findMany is called exactly twice total: once for the list
      // itself, once for the duplicate-check batch - never once per row.
      expect(prisma.client.expense.findMany).toHaveBeenCalledTimes(2);
    });

    it('does not compute or attach flags for a non-PENDING status filter or an unfiltered list', async () => {
      prisma.client.expense.findMany.mockResolvedValueOnce([pendingRow({ id: 'e1' })]);

      const approvedResult = await service.list(
        { status: ExpenseStatus.APPROVED } as never,
        ownerActor,
      );
      expect(approvedResult[0]).not.toHaveProperty('overCapFlag');
      expect(prisma.client.expenseCategoryCap.findMany).not.toHaveBeenCalled();

      prisma.client.expense.findMany.mockResolvedValueOnce([pendingRow({ id: 'e2' })]);
      const unfilteredResult = await service.list({} as never, ownerActor);
      expect(unfilteredResult[0]).not.toHaveProperty('possibleDuplicateFlag');
    });
  });
});

// Mirrors expense.service.ts's own (unexported) tripleKey/tupleKey exactly
// - a second copy for building test fixtures, not an import of a private
// helper.
function tripleKeyForTest(c: ExpenseAdvisoryCandidate): string {
  return `${c.submittedByRiderId}|${c.category}|${c.incurredAt.toISOString()}`;
}

function tupleKeyForTest(c: ExpenseAdvisoryCandidate): string {
  return `${c.submittedByRiderId}|${c.category}|${c.amount.toString()}|${c.incurredAt.toISOString()}`;
}
