import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
} from 'class-validator';
import { PaymentMethod } from '../payment.constants';

export class CreatePaymentDto {
  @IsString()
  @IsNotEmpty()
  dailyAssignmentId: string;

  @IsString()
  @IsNotEmpty()
  driverId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(10_000_000)
  amount: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  // Plan assignments only: required to accept an amount above
  // PLAN_PAYMENT_CAP_DAYS worth of the plan's daily amount, so a typo'd extra
  // zero (120,000 vs 1,200,000) needs a deliberate second tap, not just luck.
  @IsOptional()
  @IsBoolean()
  confirmLargeAmount?: boolean;
}
