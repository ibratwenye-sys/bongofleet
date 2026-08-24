import { ForbiddenException, Injectable } from '@nestjs/common';
import { GpsSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { dateOnlyInDarEsSalaam } from '../ownership-plan/ownership-plan.derivation';
import { RecordPhoneFixesDto } from './dto/record-phone-fixes.dto';

export interface RecordPhoneFixesResult {
  accepted: number;
  discarded: number;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class GpsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getOwnDriverId(actor: AuthenticatedUser): Promise<string> {
    const driver = await this.prisma.client.driver.findUnique({
      where: { userId: actor.userId },
    });
    if (!driver) {
      throw new ForbiddenException('No driver profile is associated with this account');
    }
    return driver.id;
  }

  /**
   * Stage I1 (DESIGN_GPS_TRACKING.md §4) - the security boundary: the
   * client never sends a motorcycleId. For EACH fix, independently, this
   * resolves the rider's OWN DailyAssignment for that fix's calendar date
   * (Africa/Dar_es_Salaam - dateOnlyInDarEsSalaam, the exact same
   * day-boundary helper the missed-payment/breach-streak logic already
   * uses, not a second implementation of the same three-hour-offset
   * arithmetic) and derives motorcycleId from it.
   *
   * No assignment on that date -> the fix is discarded, never erroring the
   * whole batch: a batch can legitimately span several calendar dates (the
   * rider was offline for days), so one stale/late fix must not lose every
   * fix around it.
   *
   * Assignment lookups are batched - one query for the whole batch's
   * distinct dates, never one per fix, matching the batched-query
   * discipline already established in this codebase (driver.service.ts's
   * activePlanPlateIndex, ownership-plan.service.ts's batchDerivedFigures).
   */
  async recordPhoneFixes(
    dto: RecordPhoneFixesDto,
    actor: AuthenticatedUser,
  ): Promise<RecordPhoneFixesResult> {
    const driverId = await this.getOwnDriverId(actor);

    const distinctDateKeys = [
      ...new Set(dto.fixes.map((fix) => isoDate(dateOnlyInDarEsSalaam(new Date(fix.recordedAt))))),
    ];

    const assignments = await this.prisma.client.dailyAssignment.findMany({
      where: {
        driverId,
        assignedDate: { in: distinctDateKeys.map((key) => new Date(`${key}T00:00:00.000Z`)) },
      },
      select: { assignedDate: true, motorcycleId: true },
    });
    const motorcycleIdByDateKey = new Map(
      assignments.map((a) => [isoDate(a.assignedDate), a.motorcycleId]),
    );

    const rows: Prisma.GpsLocationCreateManyInput[] = [];
    let discarded = 0;
    for (const fix of dto.fixes) {
      const recordedAt = new Date(fix.recordedAt);
      const motorcycleId = motorcycleIdByDateKey.get(isoDate(dateOnlyInDarEsSalaam(recordedAt)));
      if (!motorcycleId) {
        discarded += 1;
        continue;
      }
      rows.push({
        tenantId: actor.tenantId,
        motorcycleId,
        driverId,
        source: GpsSource.PHONE,
        latitude: fix.latitude,
        longitude: fix.longitude,
        speedKmh: fix.speedKmh,
        heading: fix.heading,
        accuracyMeters: fix.accuracyMeters,
        batteryPercent: fix.batteryPercent,
        recordedAt,
      });
    }

    if (rows.length > 0) {
      await this.prisma.client.gpsLocation.createMany({ data: rows });
    }

    return { accepted: rows.length, discarded };
  }
}
