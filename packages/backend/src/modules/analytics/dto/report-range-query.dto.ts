import { IsDateString, IsOptional } from 'class-validator';

/**
 * Optional inclusive [from, to] calendar-day window for a report. Omitting both
 * means all-time. Dates are YYYY-MM-DD and interpreted in UTC.
 */
export class ReportRangeQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
