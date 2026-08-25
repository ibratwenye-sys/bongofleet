import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { cellText, detectMangledIdentifierCell } from './bulk-import.excel';
import { SHEET_COLUMNS, TemplateColumn } from './bulk-import.template';
import { BULK_IMPORT_SHEETS, BulkImportSheet } from './bulk-import.types';

const SHEET_TITLE: Record<BulkImportSheet, string> = {
  vehicles: 'Vehicles',
  drivers: 'Drivers',
  assignments: 'Assignments',
  ownershipPlans: 'Ownership plans',
};

export interface ParsedRow {
  row: number;
  /** Column field key -> the cell's plain text, already trimmed. Never
   *  further normalized here (uppercasing a registration number, etc.) -
   *  that's bulk-import.validator.ts's job, since what counts as
   *  normalization is column-specific. */
  values: Record<string, string>;
  /** Column field key -> the plain-language corruption message, for a
   *  column whose cell exceljs reports as a stored Number where it must be
   *  Text (§3). Checked by the validator alongside every other per-column
   *  rule, not raised here, so a row can report every problem it has at
   *  once rather than stopping at the first. */
  corruptions: Record<string, string>;
}

export interface ParsedSheet {
  sheet: BulkImportSheet;
  columns: TemplateColumn[];
  rows: ParsedRow[];
}

export interface ParsedWorkbook {
  sheets: Record<BulkImportSheet, ParsedSheet>;
}

function findWorksheet(workbook: ExcelJS.Workbook, sheet: BulkImportSheet): ExcelJS.Worksheet {
  const title = SHEET_TITLE[sheet];
  const worksheet = workbook.worksheets.find(
    (ws) => ws.name.trim().toLowerCase() === title.toLowerCase(),
  );
  if (!worksheet) {
    throw new BadRequestException(
      `This workbook is missing the "${title}" sheet - download the templates again and use ` +
        'them as the starting point.',
    );
  }
  return worksheet;
}

function isRowBlank(row: ExcelJS.Row, columnCount: number): boolean {
  for (let i = 1; i <= columnCount; i += 1) {
    if (cellText(row.getCell(i)) !== '') return false;
  }
  return true;
}

function parseSheet(workbook: ExcelJS.Workbook, sheet: BulkImportSheet): ParsedSheet {
  const columns = SHEET_COLUMNS[sheet];
  const worksheet = findWorksheet(workbook, sheet);

  const headerRow = worksheet.getRow(1);
  const columnIndexByField = new Map<string, number>();
  for (const column of columns) {
    let found: number | null = null;
    for (let i = 1; i <= worksheet.columnCount; i += 1) {
      if (cellText(headerRow.getCell(i)).toLowerCase() === column.header.toLowerCase()) {
        found = i;
        break;
      }
    }
    if (found === null) {
      throw new BadRequestException(
        `The "${SHEET_TITLE[sheet]}" sheet is missing the "${column.header}" column - download ` +
          'the templates again and use them as the starting point.',
      );
    }
    columnIndexByField.set(column.field, found);
  }

  const rows: ParsedRow[] = [];
  const lastRow = worksheet.lastRow?.number ?? 1;
  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (isRowBlank(row, worksheet.columnCount)) continue;

    const values: Record<string, string> = {};
    const corruptions: Record<string, string> = {};
    for (const column of columns) {
      const index = columnIndexByField.get(column.field);
      if (index === undefined) continue;
      const cell = row.getCell(index);
      if (column.asText) {
        const mangled = detectMangledIdentifierCell(cell);
        if (mangled) {
          corruptions[column.field] = mangled;
        }
      }
      values[column.field] = cellText(cell);
    }
    rows.push({ row: rowNumber, values, corruptions });
  }

  return { sheet, columns, rows };
}

/** Stage BI1 (§1) - the whole workbook, parsed once and reused for both
 *  preview and commit (commit re-runs this exact function, never trusts a
 *  prior preview's result - see bulk-import.service.ts). Throws only for a
 *  structurally broken upload (wrong file, missing sheet/column); anything
 *  wrong with a specific row's data is a row-level error surfaced by the
 *  validator instead. */
export function parseWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  return workbook.xlsx
    .load(buffer as unknown as ExcelJS.Buffer)
    .then((wb) => {
      const sheets = Object.fromEntries(
        BULK_IMPORT_SHEETS.map((sheet) => [sheet, parseSheet(wb, sheet)]),
      ) as Record<BulkImportSheet, ParsedSheet>;
      return { sheets };
    })
    .catch((error: unknown) => {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'Could not read this file as an Excel workbook - make sure it is a .xlsx file saved from ' +
          'the downloaded templates.',
      );
    });
}
