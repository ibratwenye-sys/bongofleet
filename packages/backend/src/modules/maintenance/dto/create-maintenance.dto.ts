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

export class CreateMaintenanceDto {
  @IsString()
  @IsNotEmpty()
  motorcycleId: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(10_000_000)
  cost: number;

  @IsDateString()
  performedAt: string;

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
