import { IsDateString, IsOptional } from 'class-validator';

/** Omitting both means all-time - same convention as ReportRangeQueryDto. */
export class MethodBreakdownQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
