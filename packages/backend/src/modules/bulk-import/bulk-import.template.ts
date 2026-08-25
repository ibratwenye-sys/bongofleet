import * as ExcelJS from 'exceljs';
import { formatColumnAsText } from './bulk-import.excel';
import { BulkImportSheet } from './bulk-import.types';

export interface TemplateColumn {
  header: string;
  /** Internal field key - also the header-matching key the parser uses to
   *  locate this column by NAME (case-insensitive), not position, so a
   *  column the owner nudges sideways still parses correctly. One list of
   *  columns, shared by the template builder and the parser, so the two can
   *  never drift apart. */
  field: string;
  note: string;
  example: string | number;
  /** Phone/NIDA/registration columns - formatted Text (@) so Excel never
   *  silently mangles what the owner types (§3). */
  asText?: boolean;
  /** Required for a row to be anything other than an error - checked
   *  generically by the parser; column-specific rules (numeric, enum, date)
   *  are checked by bulk-import.validator.ts. */
  required?: boolean;
}

const SHEET_TITLE: Record<BulkImportSheet, string> = {
  vehicles: 'Vehicles',
  drivers: 'Drivers',
  assignments: 'Assignments',
  ownershipPlans: 'Ownership plans',
};

const VEHICLES_COLUMNS: TemplateColumn[] = [
  {
    header: 'Registration Number',
    field: 'registrationNumber',
    note: 'The number plate, exactly as it appears on the vehicle. Used to match this vehicle on a re-import.',
    example: 'T123 ABC',
    asText: true,
    required: true,
  },
  {
    header: 'Vehicle Type',
    field: 'vehicleType',
    note: 'One of MOTORBIKE, BAJAJI, CAR, TRUCK. Leave blank for MOTORBIKE.',
    example: 'MOTORBIKE',
  },
  { header: 'Make', field: 'make', note: 'Optional.', example: 'Bajaj' },
  { header: 'Model', field: 'model', note: 'Optional.', example: 'Boxer' },
  { header: 'Year', field: 'year', note: 'Optional.', example: 2022 },
  {
    header: 'Chassis Number',
    field: 'chassisNumber',
    note: 'Optional.',
    example: 'MD2A11EX1JWB12345',
  },
  { header: 'Colour', field: 'colour', note: 'Optional.', example: 'Red' },
];

const DRIVERS_COLUMNS: TemplateColumn[] = [
  { header: 'First Name', field: 'firstName', note: 'Required.', example: 'Juma', required: true },
  { header: 'Last Name', field: 'lastName', note: 'Required.', example: 'Hassan', required: true },
  {
    header: 'Phone',
    field: 'phone',
    note: 'Required. Used to match this driver on a re-import if no NIDA number is given.',
    example: '0712345678',
    asText: true,
    required: true,
  },
  {
    header: 'NIDA Number',
    field: 'nationalId',
    note: 'Optional, but used to match this driver on a re-import when present, ahead of phone.',
    example: '19900512345678901',
    asText: true,
  },
  {
    header: 'Email',
    field: 'email',
    note: "Optional. Leave blank if the driver doesn't have one - a placeholder is generated.",
    example: '',
  },
  {
    header: 'Emergency Contact',
    field: 'emergencyContact',
    note: 'Optional.',
    example: '',
  },
  { header: 'Residence Ward', field: 'residenceWard', note: 'Optional.', example: '' },
  { header: 'Residence District', field: 'residenceDistrict', note: 'Optional.', example: '' },
  { header: 'Residence Region', field: 'residenceRegion', note: 'Optional.', example: '' },
];

const ASSIGNMENTS_COLUMNS: TemplateColumn[] = [
  {
    header: 'Driver Phone',
    field: 'driverPhone',
    note: 'The phone number from the Drivers sheet - identifies which driver this row is about.',
    example: '0712345678',
    asText: true,
    required: true,
  },
  {
    header: 'Vehicle Registration Number',
    field: 'vehicleRegistrationNumber',
    note: 'The registration number from the Vehicles sheet - which vehicle this driver currently drives.',
    example: 'T123 ABC',
    asText: true,
    required: true,
  },
  {
    header: 'Vehicle Category',
    field: 'vehicleCategory',
    note:
      "One of MOTORBIKE, BAJAJI, CAR, TRUCK. Leave blank to use the vehicle's own type. Used only " +
      "to set the driver's category (rider / car driver / truck driver).",
    example: 'MOTORBIKE',
  },
];

const OWNERSHIP_PLANS_COLUMNS: TemplateColumn[] = [
  {
    header: 'Driver Phone',
    field: 'driverPhone',
    note: 'The phone number from the Drivers sheet.',
    example: '0712345678',
    asText: true,
    required: true,
  },
  {
    header: 'Vehicle Registration Number',
    field: 'vehicleRegistrationNumber',
    note: 'The registration number from the Vehicles sheet.',
    example: 'T123 ABC',
    asText: true,
    required: true,
  },
  {
    header: 'Daily Amount',
    field: 'dailyAmount',
    note: 'Required. The agreed daily payment, e.g. 12000.',
    example: 12000,
    required: true,
  },
  {
    header: 'Instalment Count',
    field: 'instalmentCount',
    note: 'Required. The agreed number of payment days.',
    example: 300,
    required: true,
  },
  {
    header: 'Total Price',
    field: 'totalPrice',
    note: 'Required. The declared value of the vehicle, printed on the contract only.',
    example: 3600000,
    required: true,
  },
  { header: 'Down Payment', field: 'downPayment', note: 'Optional, defaults to 0.', example: 0 },
  {
    header: 'Start Date',
    field: 'startDate',
    note:
      'Required, YYYY-MM-DD. The date printed on the contract as when the agreement began - this ' +
      'can be in the past for an existing plan.',
    example: '2025-01-15',
    required: true,
  },
  {
    header: 'Billing Start Date',
    field: 'billingStartDate',
    note:
      'Optional, YYYY-MM-DD. The date this system should start tracking the schedule from - leave ' +
      'blank to use today. Must not be in the future.',
    example: '',
  },
  {
    header: 'Opening Balance',
    field: 'openingBalance',
    note:
      'Optional, defaults to 0. How much this driver has already paid toward this plan before ' +
      'today, if this is an existing plan being brought onto the system.',
    example: 0,
  },
  {
    header: 'Contract End Date',
    field: 'contractEndDate',
    note: 'Optional, YYYY-MM-DD.',
    example: '',
  },
  { header: 'Grace Days', field: 'graceDays', note: 'Optional, defaults to 0.', example: 0 },
  { header: 'Late Fee Amount', field: 'lateFeeAmount', note: 'Optional.', example: '' },
  {
    header: 'Breach After Consecutive Missed Days',
    field: 'breachAfterConsecutiveMissedDays',
    note: 'Optional, defaults to 5.',
    example: 5,
  },
  {
    header: 'Active Weekdays',
    field: 'activeWeekdays',
    note: 'Optional. Comma-separated, 0=Sunday..6=Saturday. Leave blank for every day.',
    example: '0,1,2,3,4,5,6',
  },
  { header: 'Notes', field: 'notes', note: 'Optional.', example: '' },
];

export const SHEET_COLUMNS: Record<BulkImportSheet, TemplateColumn[]> = {
  vehicles: VEHICLES_COLUMNS,
  drivers: DRIVERS_COLUMNS,
  assignments: ASSIGNMENTS_COLUMNS,
  ownershipPlans: OWNERSHIP_PLANS_COLUMNS,
};

export function buildTemplateWorkbook(sheet: BulkImportSheet): ExcelJS.Workbook {
  const columns = SHEET_COLUMNS[sheet];
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(SHEET_TITLE[sheet]);

  worksheet.columns = columns.map((c) => ({ header: c.header, width: 26 }));
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.note = c.note;
    if (c.asText) {
      formatColumnAsText(worksheet, i + 1);
    }
  });

  worksheet.addRow(columns.map((c) => c.example));

  return workbook;
}
