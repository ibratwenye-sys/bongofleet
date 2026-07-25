import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { MotorcycleStatus, VehicleType } from '@prisma/client';

export class ListMotorcyclesQueryDto {
  @IsOptional()
  @IsEnum(MotorcycleStatus)
  status?: MotorcycleStatus;

  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
