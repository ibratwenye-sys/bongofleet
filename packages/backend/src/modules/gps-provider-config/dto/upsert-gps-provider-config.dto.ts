import { IsNotEmpty, IsString, IsUrl, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Stage 1b (DESIGN_GPS_TRACKING.md §5). PUT /gps-provider-config's body.
 * token is the tenant's own Traccar API token (Bearer auth, per Traccar's
 * OpenAPI spec's ApiKey security scheme) - plaintext in transit over TLS
 * like any credential submission, encrypted at rest immediately by
 * GpsProviderConfigService and never echoed back in any response.
 */
export class UpsertGpsProviderConfigDto {
  // require_tld: false - a self-hosted Traccar server is commonly reached
  // via a bare IP or a local/LAN hostname (e.g. http://192.168.1.50:8082),
  // not a public domain with a top-level domain suffix.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/\/+$/, '') : value))
  @IsUrl({ require_tld: false }, { message: 'baseUrl must be a valid URL' })
  @MaxLength(300)
  baseUrl: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  token: string;
}
