import { IsDateString, IsOptional, IsString } from 'class-validator';

export class ListExpensesQueryDto {
  @IsOptional()
  @IsString()
  motorcycleId?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
