import * as ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { parseStatementFile } from './statement-parser';

async function xlsxBuffer(headers: string[], rows: (string | number | Date)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Statement');
  worksheet.addRow(headers);
  for (const row of rows) {
    worksheet.addRow(row);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('parseStatementFile', () => {
  it('auto-detects Date/Amount/Narrative headers and parses a well-formed row', async () => {
    const buffer = await xlsxBuffer(
      ['Date', 'Amount', 'Narrative'],
      [['2026-08-20', 450000, 'BF-7QK2M91X payment']],
    );
    const rows = await parseStatementFile(buffer, 'statement.xlsx');

    expect(rows).toHaveLength(1);
    expect(rows[0].error).toBeNull();
    expect(rows[0].amount).toBe(450000);
    expect(rows[0].narrative).toBe('BF-7QK2M91X payment');
    expect(rows[0].date?.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('recognizes header synonyms case-insensitively (Transaction Date / Credit / Details)', async () => {
    const buffer = await xlsxBuffer(
      ['transaction date', 'CREDIT', 'Details'],
      [['05/09/2026', 1000, 'a note']],
    );
    const rows = await parseStatementFile(buffer, 'statement.xlsx');

    expect(rows).toHaveLength(1);
    expect(rows[0].error).toBeNull();
    // d/m/y: 05/09/2026 = 5 September 2026, not 9 May.
    expect(rows[0].date?.toISOString().slice(0, 10)).toBe('2026-09-05');
  });

  it('accepts a real Excel date cell (not just a date-shaped string)', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Statement');
    worksheet.addRow(['Date', 'Amount', 'Narrative']);
    const row = worksheet.addRow([new Date(Date.UTC(2026, 7, 20)), 1000, 'note']);
    row.getCell(1).numFmt = 'yyyy-mm-dd';
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const rows = await parseStatementFile(buffer, 'statement.xlsx');
    expect(rows[0].date?.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('parses a parenthesized negative amount, e.g. "(500.00)"', async () => {
    const buffer = await xlsxBuffer(
      ['Date', 'Amount', 'Narrative'],
      [['2026-08-20', '(500.00)', 'x']],
    );
    const rows = await parseStatementFile(buffer, 'statement.xlsx');
    // Negative -> silently not a candidate row at all.
    expect(rows).toHaveLength(0);
  });

  it('silently skips a negative/debit row rather than erroring, on a single signed amount column', async () => {
    const buffer = await xlsxBuffer(
      ['Date', 'Amount', 'Narrative'],
      [
        ['2026-08-20', -500, 'a debit'],
        ['2026-08-21', 500, 'a credit'],
      ],
    );
    const rows = await parseStatementFile(buffer, 'statement.xlsx');

    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(500);
    expect(rows[0].narrative).toBe('a credit');
  });

  it('flags a per-row error for an unparseable date, without crashing the rest of the file', async () => {
    const buffer = await xlsxBuffer(
      ['Date', 'Amount', 'Narrative'],
      [
        ['not a date', 1000, 'bad row'],
        ['2026-08-20', 2000, 'good row'],
      ],
    );
    const rows = await parseStatementFile(buffer, 'statement.xlsx');

    expect(rows).toHaveLength(2);
    expect(rows[0].error).toContain('date');
    expect(rows[1].error).toBeNull();
  });

  it('rejects a file with neither a date nor an amount column, with a clear message', async () => {
    const buffer = await xlsxBuffer(['Reference', 'Notes'], [['x', 'y']]);
    await expect(parseStatementFile(buffer, 'statement.xlsx')).rejects.toThrow(BadRequestException);
    await expect(parseStatementFile(buffer, 'statement.xlsx')).rejects.toThrow(
      /couldn't find a date and amount column/i,
    );
  });

  it('parses a .csv file the same way as .xlsx', async () => {
    const csv = 'Date,Amount,Narrative\n2026-08-20,450000,BF-7QK2M91X payment\n';
    const rows = await parseStatementFile(Buffer.from(csv, 'utf8'), 'statement.csv');

    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(450000);
    expect(rows[0].narrative).toBe('BF-7QK2M91X payment');
  });

  it('skips blank rows', async () => {
    const buffer = await xlsxBuffer(
      ['Date', 'Amount', 'Narrative'],
      [
        ['2026-08-20', 1000, 'row 1'],
        ['', '', ''],
        ['2026-08-21', 2000, 'row 2'],
      ],
    );
    const rows = await parseStatementFile(buffer, 'statement.xlsx');
    expect(rows).toHaveLength(2);
  });
});
