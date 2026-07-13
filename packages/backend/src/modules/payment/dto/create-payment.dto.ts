import {
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
  riderId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(10_000_000)
  amount: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}
