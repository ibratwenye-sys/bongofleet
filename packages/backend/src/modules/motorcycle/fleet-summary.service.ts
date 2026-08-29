import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentAlertKind,
  DocumentOwnerType,
  MotorcycleStatus,
  PaymentAlertKind,
  PaymentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { AnalyticsService } from '../analytics/analytics.service';
import { dateOnlyInDarEsSalaam } from '../ownership-plan/ownership-plan.derivation';
import { determineMaintenanceDue } from '../notification/maintenance-due.util';
import { getIdleVehicles } from '../../common/idle-vehicles.util';
import {
  FleetAlert,
  FleetAreaGroup,
  FleetSummaryKpis,
  FleetSummaryResponse,
  FleetTypeCount,
  FleetVehicleRow,
} from './fleet-summary.types';

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may view the fleet summary');
  }
}

function money(value: Prisma.Decimal | number | string | null | undefined): string {
  return new Prisma.Decimal(value ?? 0).toFixed(2);
}

/**
 * Stage UI2 (§3) - the Fleet page's single data source. Same
 * OWNER/MANAGER gate and batched-query discipline as
 * dashboard.service.ts, which several of these queries mirror directly
 * (collectedToday, the maintenance-due scan).
 */
@Injectable()
export class FleetSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly config: ConfigService,
  ) {}

  async getSummary(
    actor: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<FleetSummaryResponse> {
    assertOwnerOrManager(actor);

    const today = dateOnlyInDarEsSalaam(now);
    const todayIso = today.toISOString().slice(0, 10);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const monthStartIso = monthStart.toISOString().slice(0, 10);

    const [
      vehicles,
      todaysAssignments,
      collectedTodayAgg,
      monthAssignments,
      perVehicleThisMonth,
      idleVehicles,
      recentAssignmentAlerts,
      recentDocumentAlerts,
    ] = await Promise.all([
      this.prisma.client.motorcycle.findMany({
        where: { isActive: true },
        select: {
          id: true,
          registrationNumber: true,
          vehicleType: true,
          status: true,
          operatingArea: true,
          currentMileage: true,
          maintenanceLogs: {
            where: {
              OR: [{ nextServiceDate: { not: null } }, { nextServiceMileage: { not: null } }],
            },
            orderBy: { performedAt: 'desc' },
            take: 1,
            select: { nextServiceDate: true, nextServiceMileage: true },
          },
        },
      }),
      this.prisma.client.dailyAssignment.findMany({
        where: { assignedDate: { gte: today, lt: tomorrow } },
        select: {
          motorcycleId: true,
          driver: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      }),
      this.prisma.client.dailyPayment.aggregate({
        _sum: { amount: true },
        where: { status: PaymentStatus.COMPLETED, paidAt: { gte: today, lt: tomorrow } },
      }),
      this.prisma.client.dailyAssignment.findMany({
        where: { assignedDate: { gte: monthStart, lt: tomorrow } },
        select: { id: true, motorcycleId: true, targetAmount: true },
      }),
      this.analytics.getPerMotorcycle({ from: monthStartIso, to: todayIso }, actor),
      getIdleVehicles(this.prisma, today),
      this.prisma.client.assignmentAlert.findMany({
        orderBy: { sentAt: 'desc' },
        take: 5,
        select: {
          kind: true,
          sentAt: true,
          targetAmount: true,
          paidAmount: true,
          dailyAssignment: { select: { motorcycle: { select: { registrationNumber: true } } } },
        },
      }),
      this.prisma.client.documentAlert.findMany({
        where: { document: { ownerType: DocumentOwnerType.MOTORCYCLE } },
        orderBy: { sentAt: 'desc' },
        take: 5,
        select: {
          kind: true,
          sentAt: true,
          document: { select: { docType: true, ownerId: true } },
        },
      }),
    ]);

    const driverByMoto = new Map(
      todaysAssignments.map((a) => [
        a.motorcycleId,
        `${a.driver.user.firstName} ${a.driver.user.lastName}`,
      ]),
    );

    const monthAssignmentIds = monthAssignments.map((a) => a.id);
    const paidByAssignment =
      monthAssignmentIds.length > 0
        ? await this.prisma.client.dailyPayment.groupBy({
            by: ['dailyAssignmentId'],
            where: {
              dailyAssignmentId: { in: monthAssignmentIds },
              status: PaymentStatus.COMPLETED,
            },
            _sum: { amount: true },
          })
        : [];
    const paidByAssignmentId = new Map(
      paidByAssignment.map((p) => [p.dailyAssignmentId, p._sum.amount]),
    );

    const targetByMoto = new Map<string, Prisma.Decimal>();
    const paidByMoto = new Map<string, Prisma.Decimal>();
    for (const a of monthAssignments) {
      targetByMoto.set(
        a.motorcycleId,
        (targetByMoto.get(a.motorcycleId) ?? new Prisma.Decimal(0)).plus(a.targetAmount),
      );
      const paid = paidByAssignmentId.get(a.id);
      if (paid) {
        paidByMoto.set(
          a.motorcycleId,
          (paidByMoto.get(a.motorcycleId) ?? new Prisma.Decimal(0)).plus(paid),
        );
      }
    }
    const pnlByMoto = new Map(perVehicleThisMonth.map((p) => [p.motorcycleId, p]));

    const withinDays = this.config.get<number>('MAINTENANCE_REMINDER_DAYS', 14);
    const mileageBuffer = this.config.get<number>('MAINTENANCE_REMINDER_MILEAGE', 500);

    let onRoadCount = 0;
    let inWorkshopCount = 0;
    const typeCounts = new Map<string, number>();
    const areaByType = new Map<string, Map<string, number>>();
    const unsetByType = new Map<string, number>();
    const vehicleRows: FleetVehicleRow[] = [];

    for (const v of vehicles) {
      typeCounts.set(v.vehicleType, (typeCounts.get(v.vehicleType) ?? 0) + 1);
      if (driverByMoto.has(v.id)) onRoadCount += 1;
      if (v.status === MotorcycleStatus.MAINTENANCE) inWorkshopCount += 1;

      if (v.operatingArea) {
        const byArea = areaByType.get(v.vehicleType) ?? new Map<string, number>();
        byArea.set(v.operatingArea, (byArea.get(v.operatingArea) ?? 0) + 1);
        areaByType.set(v.vehicleType, byArea);
      } else {
        unsetByType.set(v.vehicleType, (unsetByType.get(v.vehicleType) ?? 0) + 1);
      }

      const log = v.maintenanceLogs[0];
      const due = log
        ? determineMaintenanceDue(
            { currentMileage: v.currentMileage, ...log },
            today,
            withinDays,
            mileageBuffer,
          )
        : { kind: null };

      const pnl = pnlByMoto.get(v.id);
      const netThisMonth = pnl ? parseFloat(pnl.netProfit) : 0;
      const hasDriverToday = driverByMoto.has(v.id);
      const needsAttention =
        due.kind === 'OVERDUE' ||
        (v.status === MotorcycleStatus.ACTIVE && !hasDriverToday) ||
        netThisMonth < 0;

      vehicleRows.push({
        motorcycleId: v.id,
        registrationNumber: v.registrationNumber,
        vehicleType: v.vehicleType,
        currentDriver: driverByMoto.get(v.id) ?? null,
        operatingArea: v.operatingArea,
        targetThisMonth: money(targetByMoto.get(v.id)),
        paidThisMonth: money(paidByMoto.get(v.id)),
        netThisMonth: money(pnl?.netProfit ?? 0),
        status: v.status,
        needsAttention,
      });
    }

    vehicleRows.sort((a, b) => {
      if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
      return parseFloat(a.netThisMonth) - parseFloat(b.netThisMonth);
    });

    const typeBreakdown: FleetTypeCount[] = [...typeCounts.entries()].map(
      ([vehicleType, count]) => ({
        vehicleType,
        count,
        share: vehicles.length === 0 ? 0 : Math.round((count / vehicles.length) * 100),
      }),
    );

    const areaGroups: FleetAreaGroup[] = [...typeCounts.keys()].map((vehicleType) => ({
      vehicleType,
      areas: [...(areaByType.get(vehicleType)?.entries() ?? [])].map(([area, count]) => ({
        area,
        count,
      })),
      unset: unsetByType.get(vehicleType) ?? 0,
    }));

    // idleVehicles already excludes anyone with a driver today (see
    // getIdleVehicles) - this is that day's lost target, not the
    // cumulative lostSoFar each row also carries.
    const idleTargetLost = idleVehicles.reduce(
      (sum, v) => sum.plus(new Prisma.Decimal(v.dailyTarget ?? 0)),
      new Prisma.Decimal(0),
    );

    const kpis: FleetSummaryKpis = {
      totalVehicles: {
        count: vehicles.length,
        byType: typeBreakdown.map((t) => `${t.count} ${t.vehicleType.toLowerCase()}`).join(' · '),
      },
      onRoadToday: {
        count: onRoadCount,
        percentOfFleet:
          vehicles.length === 0 ? 0 : Math.round((onRoadCount / vehicles.length) * 100),
      },
      idleToday: { count: idleVehicles.length, targetLost: money(idleTargetLost) },
      inWorkshop: { count: inWorkshopCount },
      collectedToday: { amount: money(collectedTodayAgg._sum.amount) },
      netPerVehicleThisMonth: {
        amount:
          perVehicleThisMonth.length === 0
            ? '0.00'
            : money(
                perVehicleThisMonth
                  .reduce((sum, p) => sum.plus(p.netProfit), new Prisma.Decimal(0))
                  .dividedBy(perVehicleThisMonth.length),
              ),
      },
    };

    const worstThisMonth = perVehicleThisMonth[perVehicleThisMonth.length - 1] ?? null;
    const worstPerformerThisMonth =
      worstThisMonth && parseFloat(worstThisMonth.netProfit) < 0 ? worstThisMonth : null;

    const alerts: FleetAlert[] = this.buildAlerts(recentAssignmentAlerts, recentDocumentAlerts);

    const byType = new Map<string, { sum: Prisma.Decimal; count: number }>();
    for (const p of perVehicleThisMonth) {
      const acc = byType.get(p.vehicleType) ?? { sum: new Prisma.Decimal(0), count: 0 };
      acc.sum = acc.sum.plus(p.netProfit);
      acc.count += 1;
      byType.set(p.vehicleType, acc);
    }
    const netPerVehicleByType = [...byType.entries()]
      .map(([vehicleType, acc]) => ({
        vehicleType,
        count: acc.count,
        amount: money(acc.sum.dividedBy(acc.count)),
      }))
      .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount));

    return {
      kpis,
      typeBreakdown,
      worstPerformerThisMonth,
      alerts,
      areaGroups,
      vehicles: vehicleRows,
      idleVehicles,
      netPerVehicleByType,
    };
  }

  private buildAlerts(
    assignmentAlerts: Array<{
      kind: PaymentAlertKind;
      sentAt: Date;
      targetAmount: Prisma.Decimal;
      paidAmount: Prisma.Decimal;
      dailyAssignment: { motorcycle: { registrationNumber: string } };
    }>,
    documentAlerts: Array<{
      kind: DocumentAlertKind;
      sentAt: Date;
      document: { docType: string; ownerId: string };
    }>,
  ): FleetAlert[] {
    const alerts: FleetAlert[] = [];
    for (const a of assignmentAlerts) {
      alerts.push({
        source: 'ASSIGNMENT',
        severity: a.kind === PaymentAlertKind.NO_PAYMENT ? 'crit' : 'warn',
        title: `${a.kind === PaymentAlertKind.NO_PAYMENT ? 'No payment' : 'Shortfall'} - ${a.dailyAssignment.motorcycle.registrationNumber}`,
        description: `Target ${money(a.targetAmount)}, paid ${money(a.paidAmount)}`,
        when: a.sentAt.toISOString(),
      });
    }
    for (const d of documentAlerts) {
      alerts.push({
        source: 'DOCUMENT',
        severity: d.kind === DocumentAlertKind.EXPIRED ? 'crit' : 'warn',
        title: `${d.document.docType} ${d.kind === DocumentAlertKind.EXPIRED ? 'expired' : 'expiring soon'}`,
        description: 'Vehicle document',
        when: d.sentAt.toISOString(),
      });
    }
    alerts.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'crit' ? -1 : 1;
      return (b.when ?? '').localeCompare(a.when ?? '');
    });
    return alerts.slice(0, 6);
  }
}
