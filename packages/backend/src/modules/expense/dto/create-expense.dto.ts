import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateExpenseDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  category: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(10_000_000)
  amount: number;

  @IsDateString()
  incurredAt: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  motorcycleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
