import { IsEnum, IsOptional, IsString } from 'class-validator';
import { MotorcycleStatus } from '@prisma/client';

export class ListMotorcyclesQueryDto {
  @IsOptional()
  @IsEnum(MotorcycleStatus)
  status?: MotorcycleStatus;

  @IsOptional()
  @IsString()
  search?: string;
}
