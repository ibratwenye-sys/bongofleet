import { IsEnum } from 'class-validator';
import { Theme } from '@prisma/client';

export class UpdateThemeDto {
  @IsEnum(Theme)
  theme: Theme;
}
