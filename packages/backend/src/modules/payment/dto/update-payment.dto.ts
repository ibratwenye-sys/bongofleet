import { IsEnum, IsOptional } from 'class-validator';
import { PaymentStatus } from '@prisma/client';
import { PaymentMethod } from '../payment.constants';

export class UpdatePaymentDto {
  @IsEnum(PaymentStatus)
  status: PaymentStatus;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}
