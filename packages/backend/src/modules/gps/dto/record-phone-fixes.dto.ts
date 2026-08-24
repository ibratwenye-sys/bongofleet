import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Stage I1 (DESIGN_GPS_TRACKING.md §4). One GPS fix from the rider's own
 * phone. motorcycleId is deliberately absent - GpsService resolves it
 * server-side from the rider's own DailyAssignment on this fix's calendar
 * date, never taken from the request body. Trusting a client-supplied
 * motorcycleId would let a rider's phone report location against any
 * vehicle, not just the one they're actually assigned to that day - this
 * is the security boundary the design doc calls out.
 */
export class PhoneFixDto {
  @IsDateString()
  recordedAt: string;

  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  speedKmh?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracyMeters?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  batteryPercent?: number;
}

/**
 * Stage I1 - the batch body for POST /gps/phone. Capped at 500 fixes,
 * matching gpsQueue.ts's own client-side buffer cap (§4 - "a week offline
 * should not fill the phone") exactly, so a batch the client would ever
 * legitimately send can never be rejected here - reject an oversized batch
 * outright instead of silently truncating it server-side, which would
 * quietly lose location history with no signal to the client that it
 * happened.
 */
export class RecordPhoneFixesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PhoneFixDto)
  fixes: PhoneFixDto[];
}
