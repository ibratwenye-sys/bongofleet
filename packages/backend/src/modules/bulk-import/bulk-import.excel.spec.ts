import * as ExcelJS from 'exceljs';
import { detectMangledIdentifierCell, normalizeRegistrationNumber } from './bulk-import.excel';

// Stage BI1 (§3) - a cell exceljs reports as its Number type can only have
// gotten that way by Excel silently reformatting what the owner typed (a
// leading zero dropped from a phone number, or scientific notation for a
// long NIDA number) - detectMangledIdentifierCell must reject it without
// ever trying to reconstruct the original digits, which are already lost.
describe('detectMangledIdentifierCell', () => {
  function cellWithValue(value: ExcelJS.CellValue): ExcelJS.Cell {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet');
    const row = worksheet.getRow(1);
    const cell = row.getCell(1);
    cell.value = value;
    return cell;
  }

  it('a phone number Excel dropped the leading zero from (stored as a plain number) is rejected', () => {
    // "0712345678" typed into a General-formatted cell becomes the number
    // 712345678 - the leading zero is gone, unrecoverably.
    const cell = cellWithValue(712345678);
    const message = detectMangledIdentifierCell(cell);
    expect(message).not.toBeNull();
    expect(message).toMatch(/leading zero|scientific notation/i);
  });

  it('a long NIDA number Excel switched to scientific notation is rejected', () => {
    // "19900512345678901" typed into a General-formatted cell overflows
    // Excel's display precision and becomes 1.9900512345678901e+16 - still
    // exceljs's Number type either way, so the same check catches it. The
    // precision loss ESLint flags below is the real behavior being
    // simulated, not a mistake in the test.
    // eslint-disable-next-line no-loss-of-precision
    const cell = cellWithValue(1.9900512345678901e16);
    const message = detectMangledIdentifierCell(cell);
    expect(message).not.toBeNull();
  });

  it('a normal text cell (properly formatted as Text) is accepted, not flagged', () => {
    const cell = cellWithValue('0712345678');
    expect(detectMangledIdentifierCell(cell)).toBeNull();
  });

  it('a blank cell is accepted - "required" is a separate check, not this one', () => {
    const cell = cellWithValue(null);
    expect(detectMangledIdentifierCell(cell)).toBeNull();
  });
});

describe('normalizeRegistrationNumber', () => {
  it('trims, collapses internal whitespace, and uppercases', () => {
    expect(normalizeRegistrationNumber('  mc  651   efp ')).toBe('MC 651 EFP');
  });

  it('two real-world spellings of the same plate normalize to the same key', () => {
    // Cafrika's own roster has both of these for one vehicle.
    expect(normalizeRegistrationNumber('MC 651 EFP')).toBe(
      normalizeRegistrationNumber('mc  651 efp'),
    );
  });
});
