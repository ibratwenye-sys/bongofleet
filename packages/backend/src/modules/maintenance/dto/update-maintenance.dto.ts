import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

// motorcycleId is intentionally not updatable - a service belongs to the bike
// it was performed on. Change by deleting and re-creating if truly needed.
export class UpdateMaintenanceDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(10_000_000)
  cost?: number;

  @IsOptional()
  @IsDateString()
  performedAt?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  mechanicId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  mileageAtService?: number;

  @IsOptional()
  @IsDateString()
  nextServiceDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  nextServiceMileage?: number;
}
