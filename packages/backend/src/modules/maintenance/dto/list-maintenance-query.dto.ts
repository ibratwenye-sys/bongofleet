import { IsDateString, IsOptional, IsString } from 'class-validator';

export class ListMaintenanceQueryDto {
  @IsOptional()
  @IsString()
  motorcycleId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
