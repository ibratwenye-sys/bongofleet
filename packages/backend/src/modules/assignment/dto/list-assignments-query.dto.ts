import { IsDateString, IsOptional, IsString } from 'class-validator';

export class ListAssignmentsQueryDto {
  @IsOptional()
  @IsString()
  riderId?: string;

  @IsOptional()
  @IsString()
  motorcycleId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
