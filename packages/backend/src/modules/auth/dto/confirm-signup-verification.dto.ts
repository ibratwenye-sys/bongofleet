import { IsString, Length } from 'class-validator';
import { SIGNUP_CODE_LENGTH } from '../signup-verification.constants';

export class ConfirmSignupVerificationDto {
  // Exact length, not a minimum - the code is fixed-width, and accepting
  // anything longer would only widen what the attempt budget has to absorb.
  @IsString()
  @Length(SIGNUP_CODE_LENGTH, SIGNUP_CODE_LENGTH)
  code: string;
}
