import * as ExcelJS from 'exceljs';

/**
 * Stage BI1 (§3) - Excel silently mangles a phone number or long ID number
 * typed into a General-formatted cell: it drops a leading zero ("0712345678"
 * becomes the number 712345678) or switches to scientific notation
 * ("1.99005E+13") for anything long enough. Both are lossy - there is no way
 * to reconstruct the original digits from the mangled value - so this never
 * tries to repair or guess at one. It only detects: a cell that holds
 * exceljs's Number type (not String) in a column the templates format as
 * Text (@) can only have gotten that way by Excel re-interpreting what the
 * owner typed, which is reason enough to reject the row and ask them to
 * re-enter it as text.
 *
 * Returns null for a normal text cell (including an empty one - "required"
 * is a separate check, not this function's job).
 */
export function detectMangledIdentifierCell(cell: ExcelJS.Cell): string | null {
  if (cell.type === ExcelJS.ValueType.Number) {
    return (
      'this looks like a number Excel reformatted (a leading zero may have been dropped, or ' +
      'it may have switched to scientific notation) - open the file, format this column as ' +
      'Text, retype the value exactly as it should read, and re-upload'
    );
  }
  return null;
}

/** Plain string read of a cell, '' for blank/null - every other cell type
 *  (dates, booleans typed into the wrong column) is coerced via String() so
 *  a stray value never crashes the parser; it just fails whatever validation
 *  applies to that column instead. */
export function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in value) {
    return String((value as { text: unknown }).text ?? '');
  }
  if (typeof value === 'object' && 'result' in value) {
    return String((value as { result: unknown }).result ?? '');
  }
  return String(value).trim();
}

/** Registration numbers get written inconsistently in real fleet records
 *  ("MC 651 EFP" vs "MC651EFP") - trim, collapse internal whitespace, and
 *  uppercase before using one as a matching key anywhere (§6). */
export function normalizeRegistrationNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function normalizePhone(raw: string): string {
  return raw.trim().replace(/\s+/g, '');
}

export function normalizeNationalId(raw: string): string {
  return raw.trim().replace(/\s+/g, '');
}

const TEXT_NUMBER_FORMAT = '@';

/** Applied to every phone/NIDA/registration column on the four downloadable
 *  templates so a careful owner never hits the mangling this file's
 *  detectMangledIdentifierCell guards against - the primary defense; that
 *  detection is only the backstop for an owner who reformats the column
 *  anyway or pastes over the formatting. */
export function formatColumnAsText(worksheet: ExcelJS.Worksheet, columnIndex: number): void {
  const column = worksheet.getColumn(columnIndex);
  column.numFmt = TEXT_NUMBER_FORMAT;
}
