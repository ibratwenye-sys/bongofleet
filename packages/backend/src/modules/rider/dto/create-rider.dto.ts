import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateRiderDto {
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
}
