import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Stage G6 Part 2 - the searchable driver picker's query params. `q` is
 *  matched against the driver's name, phone, and current vehicle
 *  registration (see DriverService.search) - never trusted as a raw SQL
 *  fragment, always passed through Prisma's parameterised `contains`. */
export class SearchDriversQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  q: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit?: number;
}
