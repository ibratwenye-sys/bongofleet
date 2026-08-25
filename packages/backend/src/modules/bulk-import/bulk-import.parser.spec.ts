import * as ExcelJS from 'exceljs';
import { parseWorkbook } from './bulk-import.parser';
import { SHEET_COLUMNS } from './bulk-import.template';

const SHEET_TITLE = {
  vehicles: 'Vehicles',
  drivers: 'Drivers',
  assignments: 'Assignments',
  ownershipPlans: 'Ownership plans',
} as const;

/** Every sheet the parser expects, each with the right header row and zero
 *  data rows - the minimum a caller must build so parseWorkbook doesn't
 *  reject the workbook as missing a sheet/column before reaching whatever
 *  this test actually wants to check. */
function emptyWorkbookWithHeaders(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  for (const [sheet, columns] of Object.entries(SHEET_COLUMNS)) {
    const worksheet = workbook.addWorksheet(SHEET_TITLE[sheet as keyof typeof SHEET_TITLE]);
    worksheet.columns = columns.map((c) => ({ header: c.header, key: c.field }));
  }
  return workbook;
}

describe('parseWorkbook - Excel corruption detection (§3)', () => {
  it('flags a Drivers-sheet phone number Excel stored as a plain number', async () => {
    const workbook = emptyWorkbookWithHeaders();
    const drivers = workbook.getWorksheet('Drivers')!;
    drivers.addRow({
      firstName: 'Juma',
      lastName: 'Hassan',
      phone: 712345678, // a real number, not a string - the mangled state
    });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parseWorkbook(buffer);

    const row = parsed.sheets.drivers.rows[0];
    expect(row.corruptions.phone).toBeDefined();
    expect(row.corruptions.phone).toMatch(/leading zero|scientific notation/i);
  });

  it('flags an Ownership-plans-sheet NIDA-derived long number the same way, never silently accepted', async () => {
    const workbook = emptyWorkbookWithHeaders();
    const drivers = workbook.getWorksheet('Drivers')!;
    drivers.addRow({
      firstName: 'Azizi',
      lastName: 'Shabani',
      phone: '0712345679',
      // The precision loss ESLint flags below is the mangled-NIDA behavior
      // being simulated, not a mistake.
      // eslint-disable-next-line no-loss-of-precision
      nationalId: 1.9900512345678901e16,
    });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parseWorkbook(buffer);

    const row = parsed.sheets.drivers.rows[0];
    expect(row.corruptions.nationalId).toBeDefined();
  });

  it('a properly Text-formatted phone number is read through untouched, no corruption flag', async () => {
    const workbook = emptyWorkbookWithHeaders();
    const drivers = workbook.getWorksheet('Drivers')!;
    drivers.addRow({ firstName: 'Juma', lastName: 'Hassan', phone: '0712345678' });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parseWorkbook(buffer);

    const row = parsed.sheets.drivers.rows[0];
    expect(row.corruptions.phone).toBeUndefined();
    expect(row.values.phone).toBe('0712345678');
  });

  it('rejects a workbook missing one of the four required sheets', async () => {
    const workbook = new ExcelJS.Workbook();
    for (const [sheet, columns] of Object.entries(SHEET_COLUMNS)) {
      if (sheet === 'assignments') continue;
      const worksheet = workbook.addWorksheet(SHEET_TITLE[sheet as keyof typeof SHEET_TITLE]);
      worksheet.columns = columns.map((c) => ({ header: c.header, key: c.field }));
    }
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(parseWorkbook(buffer)).rejects.toThrow(/Assignments/);
  });
});
