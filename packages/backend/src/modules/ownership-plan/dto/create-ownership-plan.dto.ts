import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
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
import { DepositHandling } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateOwnershipPlanDto {
  @IsString()
  @IsNotEmpty()
  driverId: string;

  @IsString()
  @IsNotEmpty()
  motorcycleId: string;

  /** The guarantor this plan's contract names as next of kin - must belong
   *  to driverId (checked in the service, where a clear message fits
   *  better). Optional: a plan may have no guarantor on file yet. */
  @IsOptional()
  @IsString()
  guarantorId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  dailyAmount: number;

  // Stage G7 - the agreed number of payment days. totalOwed = dailyAmount *
  // instalmentCount, exactly - see ownership-plan.derivation.ts. Negotiated
  // directly between owner and driver, independent of totalPrice/downPayment.
  @IsInt()
  @IsPositive()
  instalmentCount: number;

  // Declared value of the vehicle and the deposit taken - printed on the
  // contract only (Stage G7); no longer used to derive totalOwed.
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  totalPrice: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  downPayment?: number;

  /** Stage G10 (§9e) - defaults to APPLIED (matches the schema default) when
   *  omitted. Ignored entirely when downPayment is 0/omitted - there is
   *  nothing to apply or hold. */
  @IsOptional()
  @IsEnum(DepositHandling)
  depositHandling?: DepositHandling;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  contractEndDate?: string;

  /** 0=Sun..6=Sat. Structural shape checked here; non-empty/no-duplicates
   *  checked in the service, where a clear business-rule message fits better. */
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
  // or the overpayment guard. Not part of the original spec's DTO list;
  // added here because otherwise these fields would be permanently
  // unreachable through the API. See Stage F2 report.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  lateFeeAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  breachAfterConsecutiveMissedDays?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
