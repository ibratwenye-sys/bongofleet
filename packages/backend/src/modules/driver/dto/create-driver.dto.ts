import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { DriverType } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateDriverDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  phone: string;

  @Transform(trim)
  @IsEmail()
  email: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  licenseNumber: string;

  @IsString()
  @MinLength(8)
  initialPassword: string;

  @IsOptional()
  @IsString()
  nationalId?: string;

  @IsOptional()
  @IsString()
  emergencyContact?: string;

  /** The residence the hire-purchase contract identifies the driver by. */
  @IsOptional()
  @IsString()
  residenceWard?: string;

  @IsOptional()
  @IsString()
  residenceDistrict?: string;

  @IsOptional()
  @IsString()
  residenceRegion?: string;

  /** Defaults to RIDER at the database level when omitted. */
  @IsOptional()
  @IsEnum(DriverType)
  driverType?: DriverType;
}
