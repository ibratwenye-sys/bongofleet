import { IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateGuarantorDto {
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
  @IsString()
  relationship?: string;

  @IsOptional()
  @IsString()
  nationalId?: string;
}
