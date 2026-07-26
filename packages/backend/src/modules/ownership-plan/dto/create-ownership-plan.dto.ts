import {
  ArrayNotEmpty,
  IsArray,
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

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateOwnershipPlanDto {
  @IsString()
  @IsNotEmpty()
  driverId: string;

  @IsString()
  @IsNotEmpty()
  motorcycleId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  dailyAmount: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  totalPrice: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  downPayment?: number;

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

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
