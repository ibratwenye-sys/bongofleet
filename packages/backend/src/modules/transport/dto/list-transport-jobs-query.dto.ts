import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TransportJobStatus } from '@prisma/client';

export class ListTransportJobsQueryDto {
  @IsOptional()
  @IsString()
  motorcycleId?: string;

  @IsOptional()
  @IsEnum(TransportJobStatus)
  status?: TransportJobStatus;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;
}
