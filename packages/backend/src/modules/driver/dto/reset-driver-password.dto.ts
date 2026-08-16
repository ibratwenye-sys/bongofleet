import { IsString, MinLength } from 'class-validator';

export class ResetDriverPasswordDto {
  // Matches CreateDriverDto.initialPassword's floor - see the note there.
  @IsString()
  @MinLength(8)
  newPassword: string;
}
