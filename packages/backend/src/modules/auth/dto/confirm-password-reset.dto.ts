import { IsEmail, IsString, Length, MinLength } from 'class-validator';
import { RESET_CODE_LENGTH } from '../password-reset.constants';

export class ConfirmPasswordResetDto {
  @IsEmail()
  email: string;

  // Exact length, not a minimum: the code is fixed-width, and accepting
  // anything longer would only widen what the attempt budget has to absorb.
  @IsString()
  @Length(RESET_CODE_LENGTH, RESET_CODE_LENGTH)
  code: string;

  // Same floor as the initial password an owner sets at driver creation
  // (create-driver.dto.ts) - a reset must not be a way to end up with a
  // weaker password than the account started with.
  @IsString()
  @MinLength(8)
  newPassword: string;
}
