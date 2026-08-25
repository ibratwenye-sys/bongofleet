import { BadRequestException } from '@nestjs/common';
import { DAR_ES_SALAAM_UTC_OFFSET_MS } from '../ownership-plan/ownership-plan.derivation';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Stage I3 (§7's date-picker replay). The inverse of dateOnlyInDarEsSalaam
 * (ownership-plan.derivation.ts): given a calendar-date STRING as the owner
 * typed it into a date picker ("2026-08-20"), returns the UTC instant range
 * `[start, end)` that calendar day actually spans in Africa/Dar_es_Salaam -
 * a fixed UTC+3, no DST, same constant as everywhere else in this codebase
 * that reasons about "which local day". `end` is exclusive, so callers
 * should filter `recordedAt >= start AND recordedAt < end`.
 *
 * Throws BadRequestException on anything that isn't a bare YYYY-MM-DD -
 * this is a query-string value, not yet validated by class-validator the
 * way a DTO body field would be (there is no natural DTO for a single GET
 * query param here), so the check happens at the one place that needs it.
 */
export function darEsSalaamDayRangeUtc(dateOnlyString: string): { start: Date; end: Date } {
  if (!DATE_ONLY_PATTERN.test(dateOnlyString)) {
    throw new BadRequestException('date must be in YYYY-MM-DD format');
  }
  const localMidnightAsUtc = new Date(`${dateOnlyString}T00:00:00.000Z`);
  if (Number.isNaN(localMidnightAsUtc.getTime())) {
    throw new BadRequestException('date must be a real calendar date');
  }
  const start = new Date(localMidnightAsUtc.getTime() - DAR_ES_SALAAM_UTC_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
