import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
} from 'class-validator';

export class CreateAssignmentDto {
  @IsString()
  @IsNotEmpty()
  motorcycleId: string;

  @IsString()
  @IsNotEmpty()
  riderId: string;

  @IsDateString()
  assignedDate: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(10_000_000)
  targetAmount: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
