import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaymentAccountKind } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreatePaymentAccountDto {
  @IsEnum(PaymentAccountKind)
  kind: PaymentAccountKind;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  provider: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  /** Required for BANK; optional for LIPA_NUMBER/MOBILE_MONEY - enforced in
   *  the service, where a kind-specific message fits better than a decorator. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
