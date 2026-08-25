import { IsDateString } from 'class-validator';

/** First-line validation only - "is this an ISO date at all". The stricter
 *  "is this a bare YYYY-MM-DD" check that actually matters for a calendar-
 *  day query lives in darEsSalaamDayRangeUtc, which every caller of
 *  GpsService.getVehiclePath goes through anyway. */
export class VehiclePathQueryDto {
  @IsDateString()
  date: string;
}
