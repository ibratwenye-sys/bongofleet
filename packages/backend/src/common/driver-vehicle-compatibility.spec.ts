import { DriverType, VehicleType } from '@prisma/client';
import { describeMismatch, isCompatible } from './driver-vehicle-compatibility';

describe('isCompatible', () => {
  it.each([
    [DriverType.RIDER, VehicleType.MOTORBIKE, true],
    [DriverType.RIDER, VehicleType.BAJAJI, true],
    [DriverType.RIDER, VehicleType.CAR, false],
    [DriverType.RIDER, VehicleType.TRUCK, false],
    [DriverType.CAR_DRIVER, VehicleType.CAR, true],
    [DriverType.CAR_DRIVER, VehicleType.MOTORBIKE, false],
    [DriverType.CAR_DRIVER, VehicleType.BAJAJI, false],
    [DriverType.CAR_DRIVER, VehicleType.TRUCK, false],
    [DriverType.TRUCK_DRIVER, VehicleType.TRUCK, true],
    [DriverType.TRUCK_DRIVER, VehicleType.MOTORBIKE, false],
    [DriverType.TRUCK_DRIVER, VehicleType.BAJAJI, false],
    [DriverType.TRUCK_DRIVER, VehicleType.CAR, false],
  ])('%s driving a %s -> %s', (driverType, vehicleType, expected) => {
    expect(isCompatible(driverType, vehicleType)).toBe(expected);
  });
});

describe('describeMismatch', () => {
  it('names both sides of the mismatch', () => {
    const message = describeMismatch(
      { name: 'Juma Hassan', driverType: DriverType.RIDER },
      { registrationNumber: 'T123 ABC', vehicleType: VehicleType.TRUCK },
    );
    expect(message).toBe(
      'Juma Hassan is a rider and cannot be assigned T123 ABC, which is a truck.',
    );
  });

  it('labels a car driver and a bajaji correctly', () => {
    const message = describeMismatch(
      { name: 'Amina Said', driverType: DriverType.CAR_DRIVER },
      { registrationNumber: 'MC-042', vehicleType: VehicleType.BAJAJI },
    );
    expect(message).toBe(
      'Amina Said is a car driver and cannot be assigned MC-042, which is a bajaji.',
    );
  });
});
