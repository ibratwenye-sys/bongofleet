import * as ExcelJS from 'exceljs';
import { SHEET_COLUMNS, TemplateColumn } from '../../src/modules/bulk-import/bulk-import.template';
import { BulkImportSheet } from '../../src/modules/bulk-import/bulk-import.types';

const SHEET_TITLE: Record<BulkImportSheet, string> = {
  vehicles: 'Vehicles',
  drivers: 'Drivers',
  assignments: 'Assignments',
  ownershipPlans: 'Ownership plans',
};

type SheetRows = Partial<Record<BulkImportSheet, Array<Record<string, string | number>>>>;

/**
 * Builds a workbook buffer with the exact header row bulk-import.parser.ts
 * expects, from plain field-keyed row objects - so an e2e test writes
 * `{ registrationNumber: 'T123 ABC', vehicleType: 'MOTORBIKE' }` rather than
 * fighting with column indices. Any field omitted from a row is left blank,
 * same as an owner leaving an optional cell empty.
 */
export async function buildBulkImportWorkbook(sheets: SheetRows): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  for (const sheet of Object.keys(SHEET_COLUMNS) as BulkImportSheet[]) {
    const columns: TemplateColumn[] = SHEET_COLUMNS[sheet];
    const worksheet = workbook.addWorksheet(SHEET_TITLE[sheet]);
    worksheet.columns = columns.map((c) => ({ header: c.header, key: c.field, width: 24 }));

    for (const row of sheets[sheet] ?? []) {
      const values: Record<string, string | number> = {};
      for (const column of columns) {
        values[column.field] = row[column.field] ?? '';
      }
      worksheet.addRow(values);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
