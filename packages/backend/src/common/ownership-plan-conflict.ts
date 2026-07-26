/**
 * Pure message-formatting for the "vehicle is part-way through being bought by
 * someone else" conflict. The query that decides whether the conflict applies
 * (does this vehicle have an ACTIVE OwnershipPlan, and is it this driver's)
 * lives in each calling service, mirroring how vehicle/driver existence
 * lookups are already done per-service rather than centralized.
 */
export interface OwnershipConflictVehicle {
  registrationNumber: string;
}

export function describeOwnershipConflict(
  vehicle: OwnershipConflictVehicle,
  planDriverName: string,
  targetDriverName: string,
): string {
  return (
    `${vehicle.registrationNumber} is on an active ownership plan for ${planDriverName} ` +
    `and cannot be assigned to ${targetDriverName}.`
  );
}
