import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { MotorcycleStatus, VehicleType } from '@prisma/client';

export class CreateMotorcycleDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  registrationNumber: string;

  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;

  @IsOptional()
  @IsString()
  make?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1980)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsString()
  gpsDeviceId?: string;

  /** The hire-purchase contract's recital identifies the vehicle by these two. */
  @IsOptional()
  @IsString()
  chassisNumber?: string;

  @IsOptional()
  @IsString()
  colour?: string;

  @IsOptional()
  @IsEnum(MotorcycleStatus)
  status?: MotorcycleStatus;
}
