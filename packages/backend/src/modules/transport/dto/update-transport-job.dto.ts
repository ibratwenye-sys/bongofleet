import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { TransportJobStatus } from '@prisma/client';

export class UpdateTransportJobDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  riderId?: string;

  @IsOptional()
  @IsBoolean()
  ownerDriven?: boolean;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  origin?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  destination?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  cargo?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(100_000_000)
  revenue?: number;

  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @IsOptional()
  @IsEnum(TransportJobStatus)
  status?: TransportJobStatus;
}
