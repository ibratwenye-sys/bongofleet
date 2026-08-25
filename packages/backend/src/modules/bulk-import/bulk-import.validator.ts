import { DriverType, VehicleType } from '@prisma/client';
import { DRIVER_TYPE_VEHICLES, isCompatible } from '../../common/driver-vehicle-compatibility';
import {
  normalizeNationalId,
  normalizePhone,
  normalizeRegistrationNumber,
} from './bulk-import.excel';
import {
  generatePlaceholderEmail,
  generatePlaceholderLicenseNumber,
} from './bulk-import.placeholder';
import { ParsedRow, ParsedWorkbook } from './bulk-import.parser';
import { RowMessage, RowResult, RowStatus, SheetResult } from './bulk-import.types';

const VEHICLE_TYPES = new Set(Object.values(VehicleType));

const VEHICLE_TYPE_BY_CATEGORY = new Map<VehicleType, DriverType>(
  (Object.entries(DRIVER_TYPE_VEHICLES) as [DriverType, VehicleType[]][]).flatMap(
    ([driverType, vehicleTypes]) =>
      vehicleTypes.map((vt): [VehicleType, DriverType] => [vt, driverType]),
  ),
);

function err(text: string): RowMessage {
  return { text, severity: 'error' };
}
function warn(text: string): RowMessage {
  return { text, severity: 'warning' };
}

function isoDateOrNull(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : raw;
}

function parseDecimal(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export interface ExistingMotorcycle {
  id: string;
  registrationNumber: string;
  vehicleType: VehicleType;
}

export interface ValidatedVehicleRow {
  row: number;
  status: RowStatus;
  registrationNumber: string;
  vehicleType: VehicleType;
  make: string | null;
  model: string | null;
  year: number | null;
  chassisNumber: string | null;
  colour: string | null;
  existingId: string | null;
  messages: RowMessage[];
}

function validateVehiclesSheet(
  rows: ParsedRow[],
  existing: ExistingMotorcycle[],
): ValidatedVehicleRow[] {
  const existingByReg = new Map(
    existing.map((m) => [normalizeRegistrationNumber(m.registrationNumber), m]),
  );
  const seenInSheet = new Map<string, number>();
  const results: ValidatedVehicleRow[] = [];

  for (const row of rows) {
    const messages: RowMessage[] = [];
    for (const [field, text] of Object.entries(row.corruptions)) {
      messages.push(err(`"${field}": ${text}`));
    }

    const registrationNumber = normalizeRegistrationNumber(row.values.registrationNumber ?? '');
    if (!registrationNumber) {
      messages.push(err('Registration Number is required.'));
    } else {
      const dupeRow = seenInSheet.get(registrationNumber);
      if (dupeRow !== undefined) {
        messages.push(err(`Registration Number is also used on row ${dupeRow} of this sheet.`));
      } else {
        seenInSheet.set(registrationNumber, row.row);
      }
    }

    const vehicleTypeRaw = (row.values.vehicleType ?? '').trim().toUpperCase();
    let vehicleType: VehicleType = VehicleType.MOTORBIKE;
    if (vehicleTypeRaw) {
      if (!VEHICLE_TYPES.has(vehicleTypeRaw as VehicleType)) {
        messages.push(
          err(
            `Vehicle Type "${row.values.vehicleType}" is not one of MOTORBIKE, BAJAJI, CAR, TRUCK.`,
          ),
        );
      } else {
        vehicleType = vehicleTypeRaw as VehicleType;
      }
    }

    const yearRaw = row.values.year ?? '';
    let year: number | null = null;
    if (yearRaw.trim() !== '') {
      const n = Number(yearRaw.trim());
      if (!Number.isInteger(n)) {
        messages.push(err(`Year "${yearRaw}" is not a whole number.`));
      } else {
        year = n;
      }
    }

    const existingMatch = registrationNumber ? existingByReg.get(registrationNumber) : undefined;
    const hasError = messages.some((m) => m.severity === 'error');

    results.push({
      row: row.row,
      status: hasError ? 'error' : existingMatch ? 'update' : 'new',
      registrationNumber,
      vehicleType,
      make: row.values.make?.trim() || null,
      model: row.values.model?.trim() || null,
      year,
      chassisNumber: row.values.chassisNumber?.trim() || null,
      colour: row.values.colour?.trim() || null,
      existingId: existingMatch?.id ?? null,
      messages,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export interface ExistingDriver {
  id: string;
  userId: string;
  phone: string;
  nationalId: string | null;
}

export interface ValidatedDriverRow {
  row: number;
  status: RowStatus;
  firstName: string;
  lastName: string;
  phone: string;
  nationalId: string | null;
  email: string;
  emergencyContact: string | null;
  residenceWard: string | null;
  residenceDistrict: string | null;
  residenceRegion: string | null;
  driverType: DriverType;
  existingId: string | null;
  existingUserId: string | null;
  licensePlaceholder: string | null;
  messages: RowMessage[];
}

function validateDriversSheet(
  rows: ParsedRow[],
  existing: ExistingDriver[],
  driverTypeByPhone: Map<string, DriverType>,
): ValidatedDriverRow[] {
  const existingByNationalId = new Map(
    existing
      .filter((d) => d.nationalId)
      .map((d) => [normalizeNationalId(d.nationalId as string), d]),
  );
  const existingByPhone = new Map(existing.map((d) => [normalizePhone(d.phone), d]));
  const seenPhones = new Map<string, number>();
  const seenNationalIds = new Map<string, number>();
  const results: ValidatedDriverRow[] = [];

  for (const row of rows) {
    const messages: RowMessage[] = [];
    for (const [field, text] of Object.entries(row.corruptions)) {
      messages.push(err(`"${field}": ${text}`));
    }

    const firstName = row.values.firstName?.trim() ?? '';
    if (!firstName) messages.push(err('First Name is required.'));
    const lastName = row.values.lastName?.trim() ?? '';
    if (!lastName) messages.push(err('Last Name is required.'));

    const phone = normalizePhone(row.values.phone ?? '');
    if (!phone) {
      messages.push(err('Phone is required.'));
    } else {
      const dupe = seenPhones.get(phone);
      if (dupe !== undefined) {
        messages.push(err(`Phone is also used on row ${dupe} of this sheet.`));
      } else {
        seenPhones.set(phone, row.row);
      }
    }

    const nationalIdRaw = (row.values.nationalId ?? '').trim();
    const nationalId = nationalIdRaw ? normalizeNationalId(nationalIdRaw) : null;
    if (nationalId) {
      const dupe = seenNationalIds.get(nationalId);
      if (dupe !== undefined) {
        messages.push(err(`NIDA Number is also used on row ${dupe} of this sheet.`));
      } else {
        seenNationalIds.set(nationalId, row.row);
      }
    }

    const matchedExisting = nationalId
      ? existingByNationalId.get(nationalId)
      : existingByPhone.get(phone);

    // Placeholders (email, license number) only matter for a brand-new
    // driver: the commit path never writes email/licenseNumber on an UPDATE
    // (bulk-import.service.ts), so generating one here for an existing
    // driver with a blank sheet cell would be pure noise - worse, a
    // misleading "no email on file" warning for a driver who already has a
    // real one, just not repeated in this row of the sheet.
    let email = (row.values.email ?? '').trim();
    let licensePlaceholder: string | null = null;
    if (!matchedExisting) {
      if (!email) {
        email = generatePlaceholderEmail();
        messages.push(
          warn(
            'No email is on file for this driver - a placeholder was generated so the account can ' +
              'be created. Fill in a real email later if this driver ever needs dashboard/app access.',
          ),
        );
      }
      licensePlaceholder = generatePlaceholderLicenseNumber();
      messages.push(
        warn(
          'No license number is on file for this driver (the template has no column for it) - a ' +
            'placeholder was generated. Fill in the real license number later.',
        ),
      );
    }

    const driverType = driverTypeByPhone.get(phone) ?? DriverType.RIDER;
    const hasError = messages.some((m) => m.severity === 'error');

    results.push({
      row: row.row,
      status: hasError ? 'error' : matchedExisting ? 'update' : 'new',
      firstName,
      lastName,
      phone,
      nationalId,
      email,
      emergencyContact: row.values.emergencyContact?.trim() || null,
      residenceWard: row.values.residenceWard?.trim() || null,
      residenceDistrict: row.values.residenceDistrict?.trim() || null,
      residenceRegion: row.values.residenceRegion?.trim() || null,
      driverType,
      existingId: matchedExisting?.id ?? null,
      existingUserId: matchedExisting?.userId ?? null,
      licensePlaceholder,
      messages,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Assignments (§ driver <-> vehicle roster; feeds driverType inference only -
// see bulk-import.service.ts's own comment on why this sheet writes nothing
// to the database by itself)
// ---------------------------------------------------------------------------

export interface ValidatedAssignmentRow {
  row: number;
  status: RowStatus;
  driverPhone: string;
  vehicleRegistrationNumber: string;
  vehicleCategory: VehicleType | null;
  messages: RowMessage[];
}

function resolveVehicleType(
  registrationNumber: string,
  vehicleRows: ValidatedVehicleRow[],
  existingMotorcycles: ExistingMotorcycle[],
): VehicleType | null {
  const inSheet = vehicleRows.find((v) => v.registrationNumber === registrationNumber);
  if (inSheet) return inSheet.vehicleType;
  const inDb = existingMotorcycles.find(
    (m) => normalizeRegistrationNumber(m.registrationNumber) === registrationNumber,
  );
  return inDb?.vehicleType ?? null;
}

function validateAssignmentsSheet(
  rows: ParsedRow[],
  vehicleRows: ValidatedVehicleRow[],
  existingMotorcycles: ExistingMotorcycle[],
  driverPhones: Set<string>,
): { results: ValidatedAssignmentRow[]; driverTypeByPhone: Map<string, DriverType> } {
  const results: ValidatedAssignmentRow[] = [];
  const driverTypeByPhone = new Map<string, DriverType>();

  for (const row of rows) {
    const messages: RowMessage[] = [];
    for (const [field, text] of Object.entries(row.corruptions)) {
      messages.push(err(`"${field}": ${text}`));
    }

    const driverPhone = normalizePhone(row.values.driverPhone ?? '');
    if (!driverPhone) {
      messages.push(err('Driver Phone is required.'));
    } else if (!driverPhones.has(driverPhone)) {
      messages.push(
        err(
          `No driver with phone ${driverPhone} was found in the Drivers sheet or existing records.`,
        ),
      );
    }

    const vehicleRegistrationNumber = normalizeRegistrationNumber(
      row.values.vehicleRegistrationNumber ?? '',
    );
    if (!vehicleRegistrationNumber) {
      messages.push(err('Vehicle Registration Number is required.'));
    }

    const categoryRaw = (row.values.vehicleCategory ?? '').trim().toUpperCase();
    let vehicleCategory: VehicleType | null = null;
    if (categoryRaw) {
      if (!VEHICLE_TYPES.has(categoryRaw as VehicleType)) {
        messages.push(
          err(
            `Vehicle Category "${row.values.vehicleCategory}" is not one of MOTORBIKE, BAJAJI, CAR, TRUCK.`,
          ),
        );
      } else {
        vehicleCategory = categoryRaw as VehicleType;
      }
    } else if (vehicleRegistrationNumber) {
      vehicleCategory = resolveVehicleType(
        vehicleRegistrationNumber,
        vehicleRows,
        existingMotorcycles,
      );
      if (!vehicleCategory) {
        messages.push(
          err(
            `No vehicle with registration number ${vehicleRegistrationNumber} was found in the ` +
              'Vehicles sheet or existing records, and no Vehicle Category was given.',
          ),
        );
      }
    }

    const hasError = messages.some((m) => m.severity === 'error');
    if (!hasError && driverPhone && vehicleCategory && !driverTypeByPhone.has(driverPhone)) {
      driverTypeByPhone.set(
        driverPhone,
        VEHICLE_TYPE_BY_CATEGORY.get(vehicleCategory) ?? DriverType.RIDER,
      );
    }

    results.push({
      row: row.row,
      status: hasError ? 'error' : 'reference',
      driverPhone,
      vehicleRegistrationNumber,
      vehicleCategory,
      messages,
    });
  }

  return { results, driverTypeByPhone };
}

// ---------------------------------------------------------------------------
// Ownership plans
// ---------------------------------------------------------------------------

export interface ExistingPlan {
  id: string;
  driverId: string;
  motorcycleId: string;
}

export interface ValidatedOwnershipPlanRow {
  row: number;
  status: RowStatus;
  driverPhone: string;
  vehicleRegistrationNumber: string;
  dailyAmount: number;
  instalmentCount: number;
  totalPrice: number;
  downPayment: number;
  startDate: string;
  billingStartDate: string;
  openingBalance: number;
  contractEndDate: string | null;
  graceDays: number;
  lateFeeAmount: number | null;
  breachAfterConsecutiveMissedDays: number;
  activeWeekdays: number[];
  notes: string | null;
  existingId: string | null;
  messages: RowMessage[];
}

function validateOwnershipPlansSheet(
  rows: ParsedRow[],
  driverRows: ValidatedDriverRow[],
  existingDrivers: ExistingDriver[],
  vehicleRows: ValidatedVehicleRow[],
  existingMotorcycles: ExistingMotorcycle[],
  existingPlans: ExistingPlan[],
  todayIso: string,
): ValidatedOwnershipPlanRow[] {
  const driverByPhoneInSheet = new Map(driverRows.map((d) => [d.phone, d]));
  const driverByPhoneExisting = new Map(existingDrivers.map((d) => [normalizePhone(d.phone), d]));
  const vehicleByRegInSheet = new Map(vehicleRows.map((v) => [v.registrationNumber, v]));
  const vehicleByRegExisting = new Map(
    existingMotorcycles.map((m) => [normalizeRegistrationNumber(m.registrationNumber), m]),
  );
  const existingPlanByPair = new Map(
    existingPlans.map((p) => [`${p.driverId}|${p.motorcycleId}`, p]),
  );

  const seenPairs = new Map<string, number>();
  const results: ValidatedOwnershipPlanRow[] = [];

  for (const row of rows) {
    const messages: RowMessage[] = [];
    for (const [field, text] of Object.entries(row.corruptions)) {
      messages.push(err(`"${field}": ${text}`));
    }

    const driverPhone = normalizePhone(row.values.driverPhone ?? '');
    const driverInSheet = driverByPhoneInSheet.get(driverPhone);
    const driverInDb = driverByPhoneExisting.get(driverPhone);
    // A brand-new driver in this same sheet has no id yet (not written until
    // commit - the service resolves driverId from driverPhone at write time
    // in that case). But a RE-IMPORT's Drivers row matches an existing
    // driver (driverInSheet.status === 'update'), which already carries the
    // real id - using that, not null, is what lets this row find its
    // existing plan below on a second commit of the same file.
    const driverId: string | null = driverInSheet
      ? driverInSheet.existingId
      : (driverInDb?.id ?? null);
    if (!driverPhone) {
      messages.push(err('Driver Phone is required.'));
    } else if (!driverInSheet && !driverInDb) {
      messages.push(
        err(
          `No driver with phone ${driverPhone} was found in the Drivers sheet or existing records.`,
        ),
      );
    }

    const vehicleRegistrationNumber = normalizeRegistrationNumber(
      row.values.vehicleRegistrationNumber ?? '',
    );
    const vehicleInSheet = vehicleByRegInSheet.get(vehicleRegistrationNumber);
    const vehicleInDb = vehicleByRegExisting.get(vehicleRegistrationNumber);
    if (!vehicleRegistrationNumber) {
      messages.push(err('Vehicle Registration Number is required.'));
    } else if (!vehicleInSheet && !vehicleInDb) {
      messages.push(
        err(
          `No vehicle with registration number ${vehicleRegistrationNumber} was found in the Vehicles sheet or existing records.`,
        ),
      );
    }

    const pairKey = `${driverPhone}|${vehicleRegistrationNumber}`;
    const dupeRow = seenPairs.get(pairKey);
    if (dupeRow !== undefined) {
      messages.push(
        err(
          `This driver + vehicle combination is also on row ${dupeRow} of this sheet - each ` +
            'plan must be its own row.',
        ),
      );
    } else {
      seenPairs.set(pairKey, row.row);
    }

    const dailyAmount = parseDecimal(row.values.dailyAmount ?? '');
    if (dailyAmount === null || dailyAmount <= 0) {
      messages.push(err('Daily Amount is required and must be a positive number.'));
    }

    const instalmentCountRaw = (row.values.instalmentCount ?? '').trim();
    const instalmentCount = instalmentCountRaw ? Number(instalmentCountRaw) : NaN;
    if (!Number.isInteger(instalmentCount) || instalmentCount <= 0) {
      messages.push(err('Instalment Count is required and must be a positive whole number.'));
    }

    const totalPrice = parseDecimal(row.values.totalPrice ?? '');
    if (totalPrice === null || totalPrice <= 0) {
      messages.push(err('Total Price is required and must be a positive number.'));
    }

    const downPaymentRaw = row.values.downPayment ?? '';
    const downPayment = downPaymentRaw.trim() === '' ? 0 : parseDecimal(downPaymentRaw);
    if (downPayment === null || downPayment < 0) {
      messages.push(err('Down Payment must not be negative.'));
    }

    const startDateRaw = (row.values.startDate ?? '').trim();
    const startDate = isoDateOrNull(startDateRaw);
    if (!startDate) {
      messages.push(err('Start Date is required and must be a valid date (YYYY-MM-DD).'));
    }

    const billingStartRaw = (row.values.billingStartDate ?? '').trim();
    let billingStartDate = todayIso;
    if (billingStartRaw) {
      const parsed = isoDateOrNull(billingStartRaw);
      if (!parsed) {
        messages.push(err('Billing Start Date must be a valid date (YYYY-MM-DD).'));
      } else {
        billingStartDate = parsed;
      }
    }
    if (billingStartDate > todayIso) {
      messages.push(err('Billing Start Date cannot be in the future.'));
    }

    const openingBalanceRaw = row.values.openingBalance ?? '';
    const openingBalance = openingBalanceRaw.trim() === '' ? 0 : parseDecimal(openingBalanceRaw);
    if (openingBalance === null || openingBalance < 0) {
      messages.push(err('Opening Balance must not be negative.'));
    }
    if (
      openingBalance !== null &&
      dailyAmount !== null &&
      Number.isInteger(instalmentCount) &&
      instalmentCount > 0 &&
      openingBalance > dailyAmount * instalmentCount
    ) {
      messages.push(err('Opening Balance cannot be more than Daily Amount x Instalment Count.'));
    }

    const contractEndRaw = (row.values.contractEndDate ?? '').trim();
    let contractEndDate: string | null = null;
    if (contractEndRaw) {
      contractEndDate = isoDateOrNull(contractEndRaw);
      if (!contractEndDate) {
        messages.push(err('Contract End Date must be a valid date (YYYY-MM-DD).'));
      }
    }

    const graceDaysRaw = (row.values.graceDays ?? '').trim();
    const graceDays = graceDaysRaw === '' ? 0 : Number(graceDaysRaw);
    if (!Number.isInteger(graceDays) || graceDays < 0) {
      messages.push(err('Grace Days must be a non-negative whole number.'));
    }

    const lateFeeRaw = row.values.lateFeeAmount ?? '';
    const lateFeeAmount = lateFeeRaw.trim() === '' ? null : parseDecimal(lateFeeRaw);
    if (lateFeeRaw.trim() !== '' && lateFeeAmount === null) {
      messages.push(err('Late Fee Amount must be a number.'));
    }

    const breachRaw = (row.values.breachAfterConsecutiveMissedDays ?? '').trim();
    const breachAfterConsecutiveMissedDays = breachRaw === '' ? 5 : Number(breachRaw);
    if (
      !Number.isInteger(breachAfterConsecutiveMissedDays) ||
      breachAfterConsecutiveMissedDays < 1
    ) {
      messages.push(
        err('Breach After Consecutive Missed Days must be a whole number of at least 1.'),
      );
    }

    const weekdaysRaw = (row.values.activeWeekdays ?? '').trim();
    let activeWeekdays = [0, 1, 2, 3, 4, 5, 6];
    if (weekdaysRaw) {
      const parts = weekdaysRaw.split(',').map((p) => p.trim());
      const nums = parts.map(Number);
      if (
        nums.some((n) => !Number.isInteger(n) || n < 0 || n > 6) ||
        new Set(nums).size !== nums.length
      ) {
        messages.push(
          err('Active Weekdays must be a comma-separated list of unique numbers 0-6 (0=Sunday).'),
        );
      } else {
        activeWeekdays = nums;
      }
    }

    const resolvedDriverType = driverInSheet?.driverType;
    const resolvedVehicleType = vehicleInSheet?.vehicleType ?? vehicleInDb?.vehicleType;
    if (
      resolvedDriverType &&
      resolvedVehicleType &&
      !isCompatible(resolvedDriverType, resolvedVehicleType)
    ) {
      messages.push(
        err(
          `${row.values.driverPhone ?? 'This driver'} is set up as a ${resolvedDriverType} and ` +
            `cannot be put on ${vehicleRegistrationNumber}, which is a ${resolvedVehicleType}.`,
        ),
      );
    }

    const existingMatch =
      driverId && vehicleInDb ? existingPlanByPair.get(`${driverId}|${vehicleInDb.id}`) : undefined;

    const hasError = messages.some((m) => m.severity === 'error');

    results.push({
      row: row.row,
      status: hasError ? 'error' : existingMatch ? 'update' : 'new',
      driverPhone,
      vehicleRegistrationNumber,
      dailyAmount: dailyAmount ?? 0,
      instalmentCount: Number.isInteger(instalmentCount) ? instalmentCount : 0,
      totalPrice: totalPrice ?? 0,
      downPayment: downPayment ?? 0,
      startDate: startDate ?? todayIso,
      billingStartDate,
      openingBalance: openingBalance ?? 0,
      contractEndDate,
      graceDays: Number.isInteger(graceDays) ? graceDays : 0,
      lateFeeAmount,
      breachAfterConsecutiveMissedDays: Number.isInteger(breachAfterConsecutiveMissedDays)
        ? breachAfterConsecutiveMissedDays
        : 5,
      activeWeekdays,
      notes: row.values.notes?.trim() || null,
      existingId: existingMatch?.id ?? null,
      messages,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Whole-workbook entry point
// ---------------------------------------------------------------------------

export interface ExistingDbState {
  motorcycles: ExistingMotorcycle[];
  drivers: ExistingDriver[];
  plans: ExistingPlan[];
}

export interface ValidatedWorkbook {
  vehicles: ValidatedVehicleRow[];
  drivers: ValidatedDriverRow[];
  assignments: ValidatedAssignmentRow[];
  ownershipPlans: ValidatedOwnershipPlanRow[];
}

export function validateWorkbook(
  parsed: ParsedWorkbook,
  existing: ExistingDbState,
  todayIso: string,
): ValidatedWorkbook {
  // Vehicles are needed (registration -> vehicleType) before Assignments can
  // resolve a category, and driverType must be known before Drivers rows are
  // built - so the order here is Vehicles, then Assignments (against a
  // provisional empty driver-phone set, since Assignments only needs to
  // confirm a phone exists somewhere, and Drivers' own phone column is
  // parsed directly for that), then Drivers (now knowing driverType), then
  // Ownership plans last, exactly the dependency order the commit itself
  // follows (see bulk-import.service.ts).
  const vehicles = validateVehiclesSheet(parsed.sheets.vehicles.rows, existing.motorcycles);

  const driverPhonesInSheet = new Set(
    parsed.sheets.drivers.rows.map((r) => normalizePhone(r.values.phone ?? '')).filter(Boolean),
  );
  const driverPhonesExisting = new Set(existing.drivers.map((d) => normalizePhone(d.phone)));
  const allKnownDriverPhones = new Set([...driverPhonesInSheet, ...driverPhonesExisting]);

  const { results: assignments, driverTypeByPhone } = validateAssignmentsSheet(
    parsed.sheets.assignments.rows,
    vehicles,
    existing.motorcycles,
    allKnownDriverPhones,
  );

  const drivers = validateDriversSheet(
    parsed.sheets.drivers.rows,
    existing.drivers,
    driverTypeByPhone,
  );

  const ownershipPlans = validateOwnershipPlansSheet(
    parsed.sheets.ownershipPlans.rows,
    drivers,
    existing.drivers,
    vehicles,
    existing.motorcycles,
    existing.plans,
    todayIso,
  );

  return { vehicles, drivers, assignments, ownershipPlans };
}

function toRowResult<T extends { row: number; status: RowStatus; messages: RowMessage[] }>(
  row: T,
  values: Record<string, string | number | null>,
): RowResult {
  return { row: row.row, status: row.status, values, messages: row.messages };
}

export function toSheetResults(validated: ValidatedWorkbook): SheetResult[] {
  return [
    {
      sheet: 'vehicles',
      rows: validated.vehicles.map((r) =>
        toRowResult(r, {
          registrationNumber: r.registrationNumber,
          vehicleType: r.vehicleType,
          make: r.make,
          model: r.model,
          year: r.year,
          chassisNumber: r.chassisNumber,
          colour: r.colour,
        }),
      ),
    },
    {
      sheet: 'drivers',
      rows: validated.drivers.map((r) =>
        toRowResult(r, {
          firstName: r.firstName,
          lastName: r.lastName,
          phone: r.phone,
          nationalId: r.nationalId,
          email: r.email,
          driverType: r.driverType,
        }),
      ),
    },
    {
      sheet: 'assignments',
      rows: validated.assignments.map((r) =>
        toRowResult(r, {
          driverPhone: r.driverPhone,
          vehicleRegistrationNumber: r.vehicleRegistrationNumber,
          vehicleCategory: r.vehicleCategory,
        }),
      ),
    },
    {
      sheet: 'ownershipPlans',
      rows: validated.ownershipPlans.map((r) =>
        toRowResult(r, {
          driverPhone: r.driverPhone,
          vehicleRegistrationNumber: r.vehicleRegistrationNumber,
          dailyAmount: r.dailyAmount,
          instalmentCount: r.instalmentCount,
          totalPrice: r.totalPrice,
          startDate: r.startDate,
          billingStartDate: r.billingStartDate,
          openingBalance: r.openingBalance,
        }),
      ),
    },
  ];
}

export function computeCanCommit(validated: ValidatedWorkbook): boolean {
  const allRows = [
    ...validated.vehicles,
    ...validated.drivers,
    ...validated.assignments,
    ...validated.ownershipPlans,
  ];
  return allRows.every((r) => r.status !== 'error');
}
