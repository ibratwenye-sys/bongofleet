import { IsBoolean, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaymentAccountKind } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdatePaymentAccountDto {
  @IsOptional()
  @IsEnum(PaymentAccountKind)
  kind?: PaymentAccountKind;

  @IsOptional()
  @Transform(trim)
  @IsString()
  provider?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  accountNumber?: string;

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
