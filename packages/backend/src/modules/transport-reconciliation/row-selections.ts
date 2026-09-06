import { BadRequestException } from '@nestjs/common';

/**
 * One statement row's outcome: a real TransportJob id the owner confirmed,
 * or the literal string 'skip'. A row simply omitted from the array is
 * treated identically to an explicit 'skip' - see
 * TransportReconciliationService.commit.
 */
export interface RowSelection {
  rowIndex: number;
  transportJobId: string;
}

/**
 * multipart/form-data has no native nested-object field - `selections`
 * travels as a JSON-encoded string alongside the file, read via
 * @Body('selections') as a plain string (bypassing class-validator's
 * whole-DTO pipeline, which does not reliably hydrate a JSON-string-encoded
 * nested array field from a multipart body - class-transformer's
 * @Type/@ValidateNested combination silently dropped every property on
 * each parsed element when tried here, confirmed by reading the actual
 * runtime error rather than assumed). Parsed and shape-checked manually
 * instead - simpler and more debuggable than fighting that interaction.
 */
export function parseRowSelections(raw: unknown): RowSelection[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new BadRequestException('selections must be valid JSON');
    }
  }

  if (!Array.isArray(value)) {
    throw new BadRequestException('selections must be an array');
  }

  return value.map((item, index) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as Record<string, unknown>).rowIndex !== 'number' ||
      typeof (item as Record<string, unknown>).transportJobId !== 'string' ||
      (item as Record<string, unknown>).transportJobId === ''
    ) {
      throw new BadRequestException(
        `selections[${index}] must be { rowIndex: number, transportJobId: string }`,
      );
    }
    return {
      rowIndex: (item as Record<string, unknown>).rowIndex as number,
      transportJobId: (item as Record<string, unknown>).transportJobId as string,
    };
  });
}
