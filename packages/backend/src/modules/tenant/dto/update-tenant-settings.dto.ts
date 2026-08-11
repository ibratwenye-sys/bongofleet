import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** The contract's company party block (§Part 1) - the fields the design doc
 *  lists as missing on Tenant. Name/contactEmail/contactPhone are not here:
 *  there is no requirement to edit them yet, and this stays a narrow
 *  "settings" surface rather than growing into general tenant CRUD. */
export class UpdateTenantSettingsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  physicalAddress?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  directorName?: string;
}
