import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTrackingLinkDto {
  /** Omitted = whole-fleet link. */
  @IsOptional()
  @IsString()
  motorcycleId?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  label: string;

  /**
   * Three states, all meaningful (see TrackingLink.expiresAt's schema
   * comment): omitted (key absent from the request body) -> the service
   * defaults it to now + 7 days; an ISO date string -> that expiry;
   * explicit `null` -> no expiry, ever. @IsOptional() skips validation for
   * both omitted and null, so the distinction between "omitted" and
   * "explicitly null" survives into the service as `undefined` vs `null`
   * on this property - do not collapse that in the service layer.
   */
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}
