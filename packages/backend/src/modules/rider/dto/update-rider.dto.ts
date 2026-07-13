import { IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateRiderDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  firstName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  lastName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  phone?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  licenseNumber?: string;

  @IsOptional()
  @IsString()
  nationalId?: string;

  @IsOptional()
  @IsString()
  emergencyContact?: string;
}
