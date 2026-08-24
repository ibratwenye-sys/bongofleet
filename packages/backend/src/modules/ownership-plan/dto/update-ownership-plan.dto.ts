import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
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

  // Stage G7 - see create-ownership-plan.dto.ts.
  @IsOptional()
  @IsInt()
  @IsPositive()
  instalmentCount?: number;

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

  // Stage G10 - completion checklist. No dedicated endpoint existed for
  // these before this stage (registrationCardHandedOverAt/
  // spareKeyHandedOverAt/nameTransferConfirmedAt sat on the schema unused
  // since Stage F2 - see the service). Each is a one-way-feeling toggle in
  // the UI but genuinely two-way here: true stamps the *At field to now,
  // false clears it back to null, so a mis-click is recoverable without
  // reaching for Prisma Studio. depositReturned additionally requires the
  // plan to be HELD_REFUNDABLE - see the service, which is where that
  // check belongs (a clear BadRequest message fits better there).
  @IsOptional()
  @IsBoolean()
  registrationCardHandedOver?: boolean;

  @IsOptional()
  @IsBoolean()
  spareKeyHandedOver?: boolean;

  @IsOptional()
  @IsBoolean()
  nameTransferConfirmed?: boolean;

  @IsOptional()
  @IsBoolean()
  depositReturned?: boolean;
}
