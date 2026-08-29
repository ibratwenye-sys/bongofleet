import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  DocumentAlertKind,
  DocumentOwnerType,
  PaymentAlertKind,
  PaymentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { dateOnlyInDarEsSalaam } from '../ownership-plan/ownership-plan.derivation';
import { DriverScore, DriverScoreService, ScoreBand } from './driver-score';

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may view the driver scoreboard');
  }
}

function money(value: Prisma.Decimal | number): string {
  return new Prisma.Decimal(value).toFixed(2);
}

export interface DriverScoreboardKpis {
  totalDrivers: number;
  excellent: number;
  good: number;
  watch: number;
  atRisk: number;
}

export type DriverAlertSource = 'ASSIGNMENT' | 'DOCUMENT';

export interface DriverAlert {
  source: DriverAlertSource;
  severity: 'crit' | 'warn';
  title: string;
  description: string;
  when: string;
}

export interface BandDistributionRow {
  band: ScoreBand;
  count: number;
  share: number;
}

export interface DriverScoreboardResponse {
  kpis: DriverScoreboardKpis;
  drivers: DriverScore[];
  /** Rail's AI Insights slot - the lowest-scoring driver's real shortfall
   *  (score.note), never an invented behavioural narrative. Null when
   *  nothing is scored at all. */
  lowestScoring: DriverScore | null;
  alerts: DriverAlert[];
  bandDistribution: BandDistributionRow[];
  /** Closing row - missed-payment total this month across all drivers, in
   *  TZS. Real: the same shortfall definition as the Operations Center's
   *  outstandingToday KPI, just summed over the whole month instead of
   *  just today. */
  missedPaymentTotalThisMonth: string;
}

const ALL_BANDS: ScoreBand[] = ['Excellent', 'Good', 'Fair', 'Watch', 'At risk'];

/**
 * Stage UI2 (§4) - the Drivers page's single data source. Same
 * OWNER/MANAGER gate, same batched-query discipline as
 * dashboard.service.ts and driver-score.ts, which this wraps rather than
 * re-querying.
 */
@Injectable()
export class DriverScoreboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly driverScore: DriverScoreService,
  ) {}

  async getScoreboard(
    actor: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<DriverScoreboardResponse> {
    assertOwnerOrManager(actor);

    const today = dateOnlyInDarEsSalaam(now);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const [scoreboard, monthAssignments, recentAssignmentAlerts, recentDocumentAlerts] =
      await Promise.all([
        this.driverScore.scoreDrivers(actor, now),
        this.prisma.client.dailyAssignment.findMany({
          where: { assignedDate: { gte: monthStart, lt: tomorrow } },
          select: { id: true, targetAmount: true },
        }),
        this.prisma.client.assignmentAlert.findMany({
          orderBy: { sentAt: 'desc' },
          take: 5,
          select: {
            kind: true,
            sentAt: true,
            targetAmount: true,
            paidAmount: true,
            dailyAssignment: {
              select: {
                driver: { select: { user: { select: { firstName: true, lastName: true } } } },
              },
            },
          },
        }),
        this.prisma.client.documentAlert.findMany({
          where: { document: { ownerType: DocumentOwnerType.RIDER } },
          orderBy: { sentAt: 'desc' },
          take: 5,
          select: { kind: true, sentAt: true, document: { select: { docType: true } } },
        }),
      ]);

    const missedPaymentTotalThisMonth = await this.sumShortfalls(monthAssignments);

    const kpis: DriverScoreboardKpis = {
      totalDrivers: scoreboard.totalActiveDrivers,
      excellent: scoreboard.scores.filter((s) => s.band === 'Excellent').length,
      good: scoreboard.scores.filter((s) => s.band === 'Good').length,
      watch: scoreboard.scores.filter((s) => s.band === 'Watch').length,
      atRisk: scoreboard.scores.filter((s) => s.band === 'At risk').length,
    };

    const bandDistribution: BandDistributionRow[] = ALL_BANDS.map((band) => {
      const count = scoreboard.scores.filter((s) => s.band === band).length;
      return {
        band,
        count,
        share:
          scoreboard.scores.length === 0 ? 0 : Math.round((count / scoreboard.scores.length) * 100),
      };
    });

    const alerts: DriverAlert[] = [
      ...recentAssignmentAlerts.map((a): DriverAlert => ({
        source: 'ASSIGNMENT',
        severity: a.kind === PaymentAlertKind.NO_PAYMENT ? 'crit' : 'warn',
        title: a.kind === PaymentAlertKind.NO_PAYMENT ? 'No payment' : 'Shortfall',
        description: `${a.dailyAssignment.driver.user.firstName} ${a.dailyAssignment.driver.user.lastName} - target ${money(a.targetAmount)}, paid ${money(a.paidAmount)}`,
        when: a.sentAt.toISOString(),
      })),
      ...recentDocumentAlerts.map((d): DriverAlert => ({
        source: 'DOCUMENT',
        severity: d.kind === DocumentAlertKind.EXPIRED ? 'crit' : 'warn',
        title: `${d.document.docType} ${d.kind === DocumentAlertKind.EXPIRED ? 'expired' : 'expiring soon'}`,
        description: 'Driver document',
        when: d.sentAt.toISOString(),
      })),
    ]
      .sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'crit' ? -1 : 1;
        return b.when.localeCompare(a.when);
      })
      .slice(0, 6);

    return {
      kpis,
      drivers: scoreboard.scores,
      lowestScoring: scoreboard.scores[0] ?? null,
      alerts,
      bandDistribution,
      missedPaymentTotalThisMonth,
    };
  }

  private async sumShortfalls(
    assignments: { id: string; targetAmount: Prisma.Decimal }[],
  ): Promise<string> {
    if (assignments.length === 0) return '0.00';
    const paid = await this.prisma.client.dailyPayment.groupBy({
      by: ['dailyAssignmentId'],
      where: {
        dailyAssignmentId: { in: assignments.map((a) => a.id) },
        status: PaymentStatus.COMPLETED,
      },
      _sum: { amount: true },
    });
    const paidById = new Map(paid.map((p) => [p.dailyAssignmentId, p._sum.amount]));
    let total = new Prisma.Decimal(0);
    for (const a of assignments) {
      const shortfall = new Prisma.Decimal(a.targetAmount).minus(
        new Prisma.Decimal(paidById.get(a.id) ?? 0),
      );
      if (shortfall.greaterThan(0)) total = total.plus(shortfall);
    }
    return money(total);
  }
}
