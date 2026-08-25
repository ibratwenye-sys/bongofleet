/**
 * Stage BI1 - shared shapes for the bulk-import parser/validator/service.
 *
 * There is deliberately no server-side session or draft state between
 * preview and commit (see bulk-import.service.ts) - these types describe
 * one in-memory pass over one uploaded workbook, nothing persisted.
 */

export const BULK_IMPORT_SHEETS = ['vehicles', 'drivers', 'assignments', 'ownershipPlans'] as const;

export type BulkImportSheet = (typeof BULK_IMPORT_SHEETS)[number];

/** One sheet row's outcome. 'reference' is Assignments-sheet only - see its
 *  own comment in bulk-import.validator.ts for why that sheet never itself
 *  creates or updates a database row. */
export type RowStatus = 'new' | 'update' | 'reference' | 'error';

export interface RowMessage {
  /** Plain language, never a Prisma constraint name or raw exception - "Row
   *  14: this phone number already belongs to Juma Hassan", not a stack
   *  trace. */
  text: string;
  severity: 'error' | 'warning';
}

export interface RowResult {
  /** 1-based, matching the row number a fleet owner sees when they open the
   *  sheet in Excel (row 1 is the header, so the first data row is 2). */
  row: number;
  status: RowStatus;
  /** The row's own values after normalization (trim/collapse/uppercase for
   *  registration numbers, etc.) - what will actually be written, so the
   *  preview shows the owner exactly what the importer saw. */
  values: Record<string, string | number | null>;
  messages: RowMessage[];
}

export interface SheetResult {
  sheet: BulkImportSheet;
  rows: RowResult[];
}

export interface BulkImportPreviewResult {
  sheets: SheetResult[];
  /** True only when every row, across all four sheets, has zero error
   *  messages - warnings never block this. The dashboard's commit button is
   *  disabled until this is true (see BulkImportPage.tsx). */
  canCommit: boolean;
}

export interface BulkImportCommitCounts {
  vehiclesCreated: number;
  vehiclesUpdated: number;
  driversCreated: number;
  driversUpdated: number;
  ownershipPlansCreated: number;
  ownershipPlansUpdated: number;
}

export interface BulkImportCommitResult {
  preview: BulkImportPreviewResult;
  counts: BulkImportCommitCounts;
}
