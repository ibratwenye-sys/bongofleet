import { IsDateString, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateDayExcusalDto {
  /** No constraint on being in the past or on an existing assignment - a
   *  driver (or staff) can give notice for a day before the nightly
   *  generator has created that day's row (Stage G4 Part 2). */
  @IsDateString()
  excusedDate: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;
}
