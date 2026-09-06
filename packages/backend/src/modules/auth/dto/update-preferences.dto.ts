import { IsEnum, IsOptional } from 'class-validator';
import { Theme, Language } from '@prisma/client';

// Stage L1 - extended from theme-only (UpdateThemeDto) to also carry the
// language choice (DESIGN_SWAHILI_UI.md). Both optional so a caller can set
// either one alone or both together in the same PATCH /auth/me call; the
// "at least one" requirement is enforced in AuthService.updatePreferences,
// not here - class-validator has no clean built-in for "not all fields
// absent" across two independent optional properties.
export class UpdatePreferencesDto {
  @IsOptional()
  @IsEnum(Theme)
  theme?: Theme;

  @IsOptional()
  @IsEnum(Language)
  language?: Language;
}
