import { MaintenanceReminderKind } from '@prisma/client';

/**
 * Stage UI1 - extracted from maintenance-reminder-notification.service.ts's
 * scanAndNotify (Stage H4-ish), which used to compute this inline, so the
 * new Operations Center KPI endpoint (dashboard.service.ts) can produce the
 * exact same OVERDUE/DUE_SOON determination without re-deriving the
 * MAINTENANCE_REMINDER_DAYS/MAINTENANCE_REMINDER_MILEAGE threshold math a
 * second time. Pure - no Prisma calls, no dedupe-against-already-sent-email
 * logic (that stays in the notification service, which is the only caller
 * that cares about it) - just "given this bike's current numbers, is it
 * due, and why."
 *
 * Due logic (per bike's latest target-bearing maintenance log):
 * - OVERDUE if nextServiceDate is before today, OR currentMileage >=
 *   nextServiceMileage.
 * - DUE_SOON if nextServiceDate is within withinDays, OR currentMileage >=
 *   nextServiceMileage - mileageBuffer. Date and mileage are OR'd:
 *   whichever comes first wins.
 * - Neither: bike is current, or has no target at all (nextServiceDate and
 *   nextServiceMileage both null) - returns kind: null.
 */
export interface MaintenanceDueInput {
  currentMileage: number;
  nextServiceDate: Date | null;
  nextServiceMileage: number | null;
}

export interface MaintenanceDueResult {
  kind: MaintenanceReminderKind | null;
  reasons: string[];
}

export function determineMaintenanceDue(
  bike: MaintenanceDueInput,
  today: Date,
  withinDays: number,
  mileageBuffer: number,
): MaintenanceDueResult {
  const dateHorizon = new Date(today);
  dateHorizon.setUTCDate(dateHorizon.getUTCDate() + withinDays);

  const reasons: string[] = [];
  let overdue = false;
  let dueSoon = false;

  if (bike.nextServiceDate) {
    const target = bike.nextServiceDate;
    if (target.getTime() < today.getTime()) {
      overdue = true;
      reasons.push(`service was due ${target.toISOString().slice(0, 10)}`);
    } else if (target.getTime() <= dateHorizon.getTime()) {
      dueSoon = true;
      reasons.push(`service due by ${target.toISOString().slice(0, 10)}`);
    }
  }

  if (bike.nextServiceMileage != null) {
    if (bike.currentMileage >= bike.nextServiceMileage) {
      overdue = true;
      reasons.push(
        `odometer ${bike.currentMileage} km past service target ${bike.nextServiceMileage} km`,
      );
    } else if (bike.currentMileage >= bike.nextServiceMileage - mileageBuffer) {
      dueSoon = true;
      reasons.push(
        `odometer ${bike.currentMileage} km nearing service target ${bike.nextServiceMileage} km`,
      );
    }
  }

  if (!overdue && !dueSoon) {
    return { kind: null, reasons: [] };
  }
  return {
    kind: overdue ? MaintenanceReminderKind.OVERDUE : MaintenanceReminderKind.DUE_SOON,
    reasons,
  };
}
