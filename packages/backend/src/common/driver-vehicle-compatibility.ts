import { DriverType, VehicleType } from '@prisma/client';

/**
 * Which vehicle types a driver's category covers. Pure data, no Prisma calls -
 * both the assignment service and the transport-job service check the same
 * table so the rule can never drift between the two call sites.
 */
export const DRIVER_TYPE_VEHICLES: Record<DriverType, VehicleType[]> = {
  [DriverType.RIDER]: [VehicleType.MOTORBIKE, VehicleType.BAJAJI],
  [DriverType.CAR_DRIVER]: [VehicleType.CAR],
  [DriverType.TRUCK_DRIVER]: [VehicleType.TRUCK],
};

export const DRIVER_TYPE_LABELS: Record<DriverType, string> = {
  [DriverType.RIDER]: 'rider',
  [DriverType.CAR_DRIVER]: 'car driver',
  [DriverType.TRUCK_DRIVER]: 'truck driver',
};

const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  [VehicleType.MOTORBIKE]: 'motorbike',
  [VehicleType.BAJAJI]: 'bajaji',
  [VehicleType.CAR]: 'car',
  [VehicleType.TRUCK]: 'truck',
};

export function isCompatible(driverType: DriverType, vehicleType: VehicleType): boolean {
  return DRIVER_TYPE_VEHICLES[driverType].includes(vehicleType);
}

export interface MismatchDriver {
  name: string;
  driverType: DriverType;
}

export interface MismatchVehicle {
  registrationNumber: string;
  vehicleType: VehicleType;
}

/** Names both sides of the mismatch so an office clerk can act on the error without looking anything up. */
export function describeMismatch(driver: MismatchDriver, motorcycle: MismatchVehicle): string {
  return (
    `${driver.name} is a ${DRIVER_TYPE_LABELS[driver.driverType]} and cannot be assigned ` +
    `${motorcycle.registrationNumber}, which is a ${VEHICLE_TYPE_LABELS[motorcycle.vehicleType]}.`
  );
}
