import { IsOptional, IsString } from 'class-validator';

export class ListRidersQueryDto {
  @IsOptional()
  @IsString()
  search?: string;
}
