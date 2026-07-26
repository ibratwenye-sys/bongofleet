import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { VehicleType } from '@prisma/client';

/**
 * Optional inclusive [from, to] calendar-day window for a report. Omitting both
 * means all-time. Dates are YYYY-MM-DD and interpreted in UTC. An optional
 * vehicleType scopes the whole report to one fleet category.
 */
export class ReportRangeQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;
}
