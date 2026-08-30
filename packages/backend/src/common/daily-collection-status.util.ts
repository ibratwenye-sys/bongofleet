import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface OutstandingAssignmentRow {
  dailyAssignmentId: string;
  motorcycleId: string;
  targetAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  balance: Prisma.Decimal;
}

export interface DailyCollectionStatus {
  todaysAssignments: { id: string; motorcycleId: string; targetAmount: Prisma.Decimal }[];
  dueToday: Prisma.Decimal;
  receivedToday: Prisma.Decimal;
  outstandingRows: OutstandingAssignmentRow[];
}

/**
 * Stage UI3 - extracted from dashboard.service.ts's buildKpis so the
 * Payments page's KPI rail computes "due today" / "received today" /
 * "still outstanding" from literally the same queries as the Operations
 * Center, not a second, possibly-drifting definition (§ no-fabrication
 * rule: this dashboard has no broader "all-time arrears" concept and must
 * not invent one). "Today" is the caller's own
 * dateOnlyInDarEsSalaam(now) - this function does not derive it, so every
 * caller shares one clock source.
 *
 * Two fixed queries plus one conditional groupBy (skipped when there are
 * no assignments today) - never one query per assignment.
 */
export async function getDailyCollectionStatus(
  prisma: PrismaService,
  today: Date,
): Promise<DailyCollectionStatus> {
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const [todaysAssignments, collectedTodayAgg] = await Promise.all([
    prisma.client.dailyAssignment.findMany({
      where: { assignedDate: { gte: today, lt: tomorrow } },
      select: { id: true, motorcycleId: true, targetAmount: true },
    }),
    prisma.client.dailyPayment.aggregate({
      _sum: { amount: true },
      where: { status: PaymentStatus.COMPLETED, paidAt: { gte: today, lt: tomorrow } },
    }),
  ]);

  const dueToday = todaysAssignments.reduce(
    (sum, a) => sum.plus(a.targetAmount),
    new Prisma.Decimal(0),
  );
  const receivedToday = new Prisma.Decimal(collectedTodayAgg._sum.amount ?? 0);

  const assignmentIds = todaysAssignments.map((a) => a.id);
  const paidByAssignment =
    assignmentIds.length > 0
      ? await prisma.client.dailyPayment.groupBy({
          by: ['dailyAssignmentId'],
          where: { dailyAssignmentId: { in: assignmentIds }, status: PaymentStatus.COMPLETED },
          _sum: { amount: true },
        })
      : [];
  const paidById = new Map(paidByAssignment.map((p) => [p.dailyAssignmentId, p._sum.amount]));

  const outstandingRows: OutstandingAssignmentRow[] = [];
  for (const a of todaysAssignments) {
    const paid = new Prisma.Decimal(paidById.get(a.id) ?? 0);
    const balance = new Prisma.Decimal(a.targetAmount).minus(paid);
    if (balance.greaterThan(0)) {
      outstandingRows.push({
        dailyAssignmentId: a.id,
        motorcycleId: a.motorcycleId,
        targetAmount: new Prisma.Decimal(a.targetAmount),
        paidAmount: paid,
        balance,
      });
    }
  }

  return { todaysAssignments, dueToday, receivedToday, outstandingRows };
}
