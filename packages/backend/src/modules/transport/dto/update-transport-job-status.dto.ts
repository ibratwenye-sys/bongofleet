import { IsEnum } from 'class-validator';
import { TransportJobStatus } from '@prisma/client';

/**
 * Stage DM12 - the narrow RIDER-facing status update (PATCH .../:id/status),
 * deliberately separate from UpdateTransportJobDto's full `status?:
 * TransportJobStatus`. Validated against the whole enum (reusing it rather
 * than redeclaring the two literals) - TransportService.updateOwnStatus is
 * what actually rejects anything other than a forward SCHEDULED->IN_TRANSIT
 * or IN_TRANSIT->DELIVERED move, with a 400.
 */
export class UpdateTransportJobStatusDto {
  @IsEnum(TransportJobStatus)
  status: (typeof TransportJobStatus)['IN_TRANSIT'] | (typeof TransportJobStatus)['DELIVERED'];
}
