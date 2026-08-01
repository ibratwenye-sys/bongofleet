import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateGuarantorDto {
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

  @IsOptional()
  @IsString()
  relationship?: string;

  @IsOptional()
  @IsString()
  nationalId?: string;

  /** The next-of-kin residence printed on the hire-purchase contract. */
  @IsOptional()
  @IsString()
  residenceWard?: string;

  @IsOptional()
  @IsString()
  residenceDistrict?: string;

  @IsOptional()
  @IsString()
  residenceRegion?: string;
}
