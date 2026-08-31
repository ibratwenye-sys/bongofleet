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

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  customerName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  customerContactPhone?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(100_000_000)
  revenue: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(100_000_000)
  driverFee?: number;

  @IsDateString()
  scheduledDate: string;

  /** Set at job creation, revisable until the job completes (see
   *  UpdateTransportJobDto). When present, the in-transit card computes
   *  real progress from actual GPS fixes; when absent, it shows elapsed
   *  time and last position only - never a fabricated ETA. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @IsPositive()
  @Max(20_000)
  expectedDistanceKm?: number;

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
