import { IsDateString } from 'class-validator';

/** Stage UI3 - unlike ReportRangeQueryDto, from/to are required here: the
 *  chart this feeds (Operations Center, Payments' closing row) always
 *  knows the exact window it wants plotted, so there is no "all-time"
 *  default to fall back to. */
export class CollectionSeriesQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
