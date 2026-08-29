import { MotorcycleStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface IdleVehicleRow {
  motorcycleId: string;
  registrationNumber: string;
  vehicleType: string;
  operatingArea: string | null;
  daysUnassigned: number;
  /** The vehicle's own most recent DailyAssignment target, if it has ever
   *  had one - null when it never has. Never a fleet-average guess (see
   *  lostSoFar below). */
  dailyTarget: string | null;
  /** dailyTarget * daysUnassigned when dailyTarget is known, else null -
   *  deliberately not estimated from a fleet-wide average when the
   *  vehicle's own rate is unknown, unlike the reference mockup's "~"
   *  figures for a never-assigned vehicle. An honest "—" beats a guess
   *  dressed up as a number. */
  lostSoFar: string | null;
  reason: string;
  /** ISO date the idle run began (the day after its last assignment ended,
   *  or the vehicle's creation date if it has never been assigned) - lets
   *  a caller bound the run to a shorter window (e.g. "idle days within
   *  this month") without a second query. */
  sinceDate: string;
}

function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

/**
 * Stage UI2 (§3/§5) - "share this exact query with Fleet's idle-vehicles
 * card from section 3 — one function, not two divergent ones." Active,
 * non-retired vehicles with no DailyAssignment today. Excludes vehicles
 * currently in MAINTENANCE status - those are a repair decision, tracked
 * separately (the KPI rails' own "in workshop" tiles), not a "find a
 * driver" one, which is what this list exists to surface.
 *
 * Two fixed queries regardless of fleet size: the candidate vehicles, then
 * one batched "most recent assignment ever, per vehicle" lookup (same
 * distinct-orderBy technique as driver.service.ts's
 * currentPlatesByDriverId) - never one query per vehicle.
 */
export async function getIdleVehicles(
  prisma: PrismaService,
  today: Date,
): Promise<IdleVehicleRow[]> {
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const candidates = await prisma.client.motorcycle.findMany({
    where: {
      isActive: true,
      status: { not: MotorcycleStatus.RETIRED },
      NOT: { status: MotorcycleStatus.MAINTENANCE },
      dailyAssignments: { none: { assignedDate: { gte: today, lt: tomorrow } } },
    },
    select: {
      id: true,
      registrationNumber: true,
      vehicleType: true,
      operatingArea: true,
      createdAt: true,
    },
  });
  if (candidates.length === 0) return [];

  const lastAssignments = await prisma.client.dailyAssignment.findMany({
    where: { motorcycleId: { in: candidates.map((c) => c.id) } },
    orderBy: [{ motorcycleId: 'asc' }, { assignedDate: 'desc' }],
    distinct: ['motorcycleId'],
    select: { motorcycleId: true, assignedDate: true, targetAmount: true },
  });
  const lastByMoto = new Map(lastAssignments.map((a) => [a.motorcycleId, a]));

  return candidates
    .map((c): IdleVehicleRow => {
      const last = lastByMoto.get(c.id);
      const sinceDate = last?.assignedDate ?? c.createdAt;
      const daysUnassigned = Math.max(
        0,
        Math.round((today.getTime() - sinceDate.getTime()) / (24 * 60 * 60 * 1000)),
      );
      const dailyTarget = last ? money(new Prisma.Decimal(last.targetAmount)) : null;
      const lostSoFar = dailyTarget
        ? money(new Prisma.Decimal(dailyTarget).times(daysUnassigned))
        : null;
      return {
        motorcycleId: c.id,
        registrationNumber: c.registrationNumber,
        vehicleType: c.vehicleType,
        operatingArea: c.operatingArea,
        daysUnassigned,
        dailyTarget,
        lostSoFar,
        reason: last
          ? `No driver since ${last.assignedDate.toISOString().slice(0, 10)}`
          : 'Never assigned a driver',
        sinceDate: sinceDate.toISOString().slice(0, 10),
      };
    })
    .sort((a, b) => b.daysUnassigned - a.daysUnassigned);
}
