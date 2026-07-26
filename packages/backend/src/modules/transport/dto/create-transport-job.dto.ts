import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTransportJobDto {
  @IsString()
  @IsNotEmpty()
  motorcycleId: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  driverId?: string;

  @IsOptional()
  @IsBoolean()
  ownerDriven?: boolean;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  origin: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  destination: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  cargo?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(100_000_000)
  revenue: number;

  @IsDateString()
  scheduledDate: string;

  /**
   * The reason IS the confirmation - present and >= 10 chars means "an OWNER
   * is deliberately overriding the driver-category/vehicle-type mismatch."
   * Absent means no override was requested.
   */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  categoryOverrideReason?: string;
}
