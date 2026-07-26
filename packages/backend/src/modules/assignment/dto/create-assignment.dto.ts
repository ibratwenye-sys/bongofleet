import {
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

export class CreateAssignmentDto {
  @IsString()
  @IsNotEmpty()
  motorcycleId: string;

  @IsString()
  @IsNotEmpty()
  driverId: string;

  @IsDateString()
  assignedDate: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(10_000_000)
  targetAmount: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /**
   * The reason IS the confirmation - present and >= 10 chars means "an OWNER
   * is deliberately overriding the driver-category/vehicle-type mismatch."
   * Absent means no override was requested. There is no separate boolean, so
   * there is nothing to accidentally leave defaulted to true.
   */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  categoryOverrideReason?: string;
}
