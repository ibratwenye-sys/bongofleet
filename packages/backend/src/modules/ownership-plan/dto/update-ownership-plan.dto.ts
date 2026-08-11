import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { OwnershipPlanStatus } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Terms, status, and notes only - driverId/motorcycleId are not editable
 *  here; reassigning either means cancelling this plan and creating a new one. */
export class UpdateOwnershipPlanDto {
  /** Same validation as create (same-tenant, same-driver, checked in the
   *  service). Pass null explicitly to clear a previously-set guarantor;
   *  omit the field entirely to leave it unchanged. */
  @IsOptional()
  @IsString()
  guarantorId?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  dailyAmount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  totalPrice?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  downPayment?: number;

  @IsOptional()
  @IsDateString()
  contractEndDate?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  activeWeekdays?: number[];

  @IsOptional()
  @IsInt()
  @Min(0)
  graceDays?: number;

  // Printed on the contract only (§Part 1/3) - never read by derivation.ts
  // or the overpayment guard.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  lateFeeAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  breachAfterConsecutiveMissedDays?: number;

  @IsOptional()
  @IsEnum(OwnershipPlanStatus)
  status?: OwnershipPlanStatus;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
