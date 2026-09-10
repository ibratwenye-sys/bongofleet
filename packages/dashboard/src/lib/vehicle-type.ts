import type { TFunction } from 'i18next';
import type { VehicleType } from './types';

/**
 * Stage L7 centralized these four strings into common.json; by L18 this
 * exact map/wrapper pair had been privately duplicated into five separate
 * page files (Fleet L7, Maintenance L8, Assignments L9, Reports L12,
 * TrackingMap L18). Extracted here for the same reason gps-status.ts's own
 * statusLabel() lives in `lib/` rather than a component or a page: it's
 * shared across pages that otherwise have nothing to do with each other,
 * so a page-local copy - or re-exporting from one arbitrarily "owning"
 * page - would be the wrong shape.
 */
export const VEHICLE_TYPE_LABEL_KEY: Record<VehicleType, string> = {
  MOTORBIKE: 'vehicleTypeMotorbike',
  BAJAJI: 'vehicleTypeBajaji',
  CAR: 'vehicleTypeCar',
  TRUCK: 'vehicleTypeTruck',
};

// Fleet/Maintenance/Assignments' row data types vehicleType as a loose
// `string`, not the narrower VehicleType union, so this guards against a
// value the map doesn't recognize and falls back to the raw string.
// Reports/TrackingMap's own call sites already pass real VehicleType values
// (some via an `as VehicleType` cast) - VehicleType is assignable to
// `string`, so the `in` check is simply always true for them, and this one
// defensive signature serves every existing call site with identical
// output for every real input.
//
// Considered and declined: switching to gps-status.ts's statusLabel()
// convention (reading i18n.language directly at call time via a module-
// level `import i18n from './i18n'`, taking no translator parameter at
// all) would be a legitimate alternative shape, but isn't the point of
// this cleanup - it would mean touching every one of this function's 18
// call sites' arguments for no behavior change.
export function vehicleTypeLabel(vehicleType: string, tCommon: TFunction<'common'>): string {
  return vehicleType in VEHICLE_TYPE_LABEL_KEY
    ? tCommon(VEHICLE_TYPE_LABEL_KEY[vehicleType as VehicleType])
    : vehicleType;
}
