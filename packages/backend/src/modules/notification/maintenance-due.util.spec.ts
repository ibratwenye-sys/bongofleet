import { MaintenanceReminderKind } from '@prisma/client';
import { determineMaintenanceDue, MaintenanceDueInput } from './maintenance-due.util';

const TODAY = new Date('2026-08-25T00:00:00.000Z');
const WITHIN_DAYS = 14;
const MILEAGE_BUFFER = 500;

function bike(overrides: Partial<MaintenanceDueInput> = {}): MaintenanceDueInput {
  return {
    currentMileage: 10_000,
    nextServiceDate: null,
    nextServiceMileage: null,
    ...overrides,
  };
}

/**
 * Stage UI1 - this is the exact function
 * maintenance-reminder-notification.service.ts's cron and the new
 * Operations Center KPI endpoint (dashboard.service.ts) both call, so a
 * shared fixture proves they can never silently drift apart - see this
 * file's own comment and dashboard.service.spec.ts's mirrored assertions.
 */
describe('determineMaintenanceDue', () => {
  it('no target at all (both null) -> not due', () => {
    const result = determineMaintenanceDue(bike(), TODAY, WITHIN_DAYS, MILEAGE_BUFFER);
    expect(result.kind).toBeNull();
    expect(result.reasons).toEqual([]);
  });

  it('nextServiceDate in the past -> OVERDUE', () => {
    const result = determineMaintenanceDue(
      bike({ nextServiceDate: new Date('2026-08-01T00:00:00.000Z') }),
      TODAY,
      WITHIN_DAYS,
      MILEAGE_BUFFER,
    );
    expect(result.kind).toBe(MaintenanceReminderKind.OVERDUE);
    expect(result.reasons[0]).toMatch(/service was due 2026-08-01/);
  });

  it('nextServiceDate within withinDays -> DUE_SOON', () => {
    const result = determineMaintenanceDue(
      bike({ nextServiceDate: new Date('2026-09-05T00:00:00.000Z') }), // 11 days out
      TODAY,
      WITHIN_DAYS,
      MILEAGE_BUFFER,
    );
    expect(result.kind).toBe(MaintenanceReminderKind.DUE_SOON);
  });

  it('nextServiceDate beyond withinDays -> not due', () => {
    const result = determineMaintenanceDue(
      bike({ nextServiceDate: new Date('2026-10-01T00:00:00.000Z') }),
      TODAY,
      WITHIN_DAYS,
      MILEAGE_BUFFER,
    );
    expect(result.kind).toBeNull();
  });

  it('currentMileage >= nextServiceMileage -> OVERDUE, not due-soon', () => {
    const result = determineMaintenanceDue(
      bike({ currentMileage: 20_000, nextServiceMileage: 20_000 }),
      TODAY,
      WITHIN_DAYS,
      MILEAGE_BUFFER,
    );
    expect(result.kind).toBe(MaintenanceReminderKind.OVERDUE);
    expect(result.reasons[0]).toMatch(/odometer 20000 km past service target 20000 km/);
  });

  it('currentMileage within mileageBuffer of target -> DUE_SOON', () => {
    const result = determineMaintenanceDue(
      bike({ currentMileage: 19_600, nextServiceMileage: 20_000 }), // 400 km short, buffer 500
      TODAY,
      WITHIN_DAYS,
      MILEAGE_BUFFER,
    );
    expect(result.kind).toBe(MaintenanceReminderKind.DUE_SOON);
  });

  it('mileage OVERDUE wins even when the date alone would only be DUE_SOON - date and mileage are OR-ed, not averaged', () => {
    const result = determineMaintenanceDue(
      bike({
        currentMileage: 20_500,
        nextServiceMileage: 20_000, // overdue by mileage
        nextServiceDate: new Date('2026-09-05T00:00:00.000Z'), // due-soon by date alone
      }),
      TODAY,
      WITHIN_DAYS,
      MILEAGE_BUFFER,
    );
    expect(result.kind).toBe(MaintenanceReminderKind.OVERDUE);
    expect(result.reasons).toHaveLength(2);
  });

  it('exactly at the withinDays horizon is still DUE_SOON (inclusive boundary)', () => {
    const horizon = new Date(TODAY);
    horizon.setUTCDate(horizon.getUTCDate() + WITHIN_DAYS);
    const result = determineMaintenanceDue(
      bike({ nextServiceDate: horizon }),
      TODAY,
      WITHIN_DAYS,
      MILEAGE_BUFFER,
    );
    expect(result.kind).toBe(MaintenanceReminderKind.DUE_SOON);
  });
});
