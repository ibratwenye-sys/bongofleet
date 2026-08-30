import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsPositive, Max } from 'class-validator';
import { VehicleType } from '@prisma/client';

export class MonthlyPnlSeriesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(24)
  monthsBack?: number = 6;

  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;
}
