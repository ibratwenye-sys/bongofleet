import { Readable } from 'node:stream';
import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { cellText } from '../bulk-import/bulk-import.excel';

export interface ParsedStatementRow {
  /** 1-based spreadsheet row number - what a preview/commit response
   *  identifies a row by, and what an owner would see if they opened the
   *  file themselves. */
  rowNumber: number;
  date: Date | null;
  amount: number | null;
  narrative: string;
  /** Set when this row's date or amount couldn't be parsed - shown in the
   *  preview, never committed unless fixed and re-uploaded. */
  error: string | null;
}

// Stage TRANSPORT_DESIGN §6 - case-insensitive header synonyms. "credit" /
// "amount credited" / "deposit" cover a dedicated money-in column; "amount"
// covers a single signed column (positive = credit), in which case only
// positive amounts ever become candidate rows below - a negative/debit
// value is silently not a row here, not an error (§ own instruction).
const DATE_HEADER_SYNONYMS = ['date', 'transaction date', 'value date'];
const AMOUNT_HEADER_SYNONYMS = ['amount', 'credit', 'amount credited', 'deposit'];
const NARRATIVE_HEADER_SYNONYMS = ['narrative', 'description', 'details', 'remarks', 'memo'];

function findColumnIndex(
  headerRow: ExcelJS.Row,
  columnCount: number,
  synonyms: string[],
): number | null {
  for (let i = 1; i <= columnCount; i += 1) {
    const text = cellText(headerRow.getCell(i)).toLowerCase().trim();
    if (synonyms.includes(text)) return i;
  }
  return null;
}

function isRowBlank(row: ExcelJS.Row, columnCount: number): boolean {
  for (let i = 1; i <= columnCount; i += 1) {
    if (cellText(row.getCell(i)) !== '') return false;
  }
  return true;
}

/** "(500.00)" (parenthesized negatives, a common accounting export
 *  convention) parses as -500, before stripping currency symbols/commas/
 *  spaces from whatever's left. */
function parseAmount(raw: string): number | null {
  let text = raw.trim();
  if (text === '') return null;
  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1);
  }
  const cleaned = text.replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return negative ? -Math.abs(value) : value;
}

/**
 * Judgment call, flagged: ambiguous d/m/y-vs-m/d/y two-digit-month dates
 * (e.g. "05/09/2026") are read as day/month/year, the Tanzanian/East
 * African convention - same locale assumption this codebase already makes
 * elsewhere (Africa/Dar_es_Salaam as the default timezone). An unambiguous
 * ISO date (2026-09-05) or a native Excel date cell never hits this
 * assumption at all.
 */
function parseDateText(raw: string): Date | null {
  const text = raw.trim();
  if (text === '') return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(year, month - 1, day));
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function parseDateCell(cell: ExcelJS.Cell): Date | null {
  const value = cell.value;
  if (value instanceof Date) {
    // A CSV cell has no native date type - ExcelJS's own CSV reader
    // heuristically parses a date-shaped string into a Date using the
    // LOCAL system timezone, which can inject an hour shift depending on
    // the machine's own offset (confirmed empirically, not assumed - a
    // "2026-08-15" cell came back as 2026-08-14T21:00:00Z on a UTC+3
    // machine). Re-derive the calendar date from the Date's own LOCAL
    // components - exactly what was fed into whatever constructor
    // produced it - and rebuild a clean UTC midnight from those, rather
    // than trusting the instant's exact time-of-day. A genuine .xlsx date-
    // serial cell has no time-of-day of its own either, so this
    // re-derivation is safe for both sources.
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  return parseDateText(cellText(cell));
}

async function loadWorksheet(buffer: Buffer, originalName: string): Promise<ExcelJS.Worksheet> {
  const isCsv = originalName.toLowerCase().endsWith('.csv');
  const workbook = new ExcelJS.Workbook();
  try {
    if (isCsv) {
      return await workbook.csv.read(Readable.from(buffer));
    }
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('no worksheet');
    }
    return worksheet;
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(
      'Could not read this file - make sure it is a .xlsx or .csv export from your bank or ' +
        'mobile-money statement.',
    );
  }
}

/**
 * Re-run on every commit call, never trusted from a prior preview - same
 * "no server-side session between preview and commit" convention
 * bulk-import.parser.ts's own parseWorkbook already documents, for the
 * same reason: a tampered request must never be able to credit an
 * arbitrary job an arbitrary amount by asserting row data the server
 * itself doesn't re-derive.
 */
export async function parseStatementFile(
  buffer: Buffer,
  originalName: string,
): Promise<ParsedStatementRow[]> {
  const worksheet = await loadWorksheet(buffer, originalName);
  const columnCount = worksheet.columnCount;
  const headerRow = worksheet.getRow(1);

  const dateIndex = findColumnIndex(headerRow, columnCount, DATE_HEADER_SYNONYMS);
  const amountIndex = findColumnIndex(headerRow, columnCount, AMOUNT_HEADER_SYNONYMS);
  const narrativeIndex = findColumnIndex(headerRow, columnCount, NARRATIVE_HEADER_SYNONYMS);

  // Narrative is best-effort (amount-fallback matching still works without
  // one - reference matching just never finds anything for that file), but
  // date and amount are load-bearing: there is nothing honest to record
  // without either.
  if (dateIndex === null || amountIndex === null) {
    throw new BadRequestException(
      "Couldn't find a date and amount column in this file - check that it has headers like " +
        '"Date" (or "Transaction Date"/"Value Date") and "Amount" (or "Credit"/"Deposit"), then ' +
        're-upload.',
    );
  }

  const rows: ParsedStatementRow[] = [];
  const lastRow = worksheet.lastRow?.number ?? 1;
  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (isRowBlank(row, columnCount)) continue;

    const narrative = narrativeIndex !== null ? cellText(row.getCell(narrativeIndex)) : '';
    const amount = parseAmount(cellText(row.getCell(amountIndex)));

    // A negative/debit value (or a blank credit-column cell on a debit
    // row) is silently not a candidate row at all - not an error.
    if (amount !== null && amount <= 0) {
      continue;
    }

    const date = parseDateCell(row.getCell(dateIndex));

    if (date === null || amount === null) {
      const missing =
        date === null && amount === null ? 'date and amount' : date === null ? 'date' : 'amount';
      rows.push({
        rowNumber,
        date,
        amount,
        narrative,
        error: `Couldn't read this row's ${missing}`,
      });
      continue;
    }

    rows.push({ rowNumber, date, amount, narrative, error: null });
  }

  return rows;
}
