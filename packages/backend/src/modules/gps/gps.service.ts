import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GpsSource, Prisma, TrackingMode, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { dateOnlyInDarEsSalaam } from '../ownership-plan/ownership-plan.derivation';
import { RecordPhoneFixesDto } from './dto/record-phone-fixes.dto';
import {
  CURRENT_POSITION_FIX_LOOKBACK,
  resolveCurrentPosition,
  type GpsFixCandidate,
} from './current-position';
import { darEsSalaamDayRangeUtc } from './dar-es-salaam-day-range';

export interface RecordPhoneFixesResult {
  accepted: number;
  discarded: number;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may view fleet tracking data');
  }
}

/**
 * Stage I3 (§7). What the live-map page's markers read. Authenticated and
 * tenant-internal (unlike Stage I2's public whitelist DTO), so it carries
 * more than a stranger would ever see - motorcycleId and vehicleType, for
 * the map to key markers and filter by category client-side.
 */
export type FleetVehiclePosition = {
  motorcycleId: string;
  registrationNumber: string;
  vehicleType: string;
  // Stage (DESIGN_GPS_TRACKING.md §6) - additive: the dashboard's "Currently
  // offline" card (tracking-map page) needs this to apply the same
  // trackingMode !== 'NONE' filter the backend's own offline-alert scan
  // uses, so a deliberately-untracked vehicle never shows there either.
  // Every other existing caller of this endpoint already ignores fields it
  // doesn't ask for, so this is not a breaking change to the response shape.
  trackingMode: TrackingMode;
} & (
  | { offline: false; latitude: number; longitude: number; recordedAt: string; source: GpsSource }
  | { offline: true; lastRecordedAt: string | null }
);

export interface VehiclePathPoint {
  recordedAt: string;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
}

const FIX_SELECT = { source: true, latitude: true, longitude: true, recordedAt: true } as const;

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

  /**
   * Stage I3 (§7) - the live-map page's markers. One query for every ACTIVE
   * motorcycle in the tenant, each with its own most-recent
   * CURRENT_POSITION_FIX_LOOKBACK fixes nested inline (Prisma's filtered
   * to-many relation fetch - one logical query, not one per vehicle, same
   * technique Stage I2's public whole-fleet lookup already uses), then
   * resolveCurrentPosition per vehicle in memory. A vehicle with zero GPS
   * history ever still appears, offline with lastRecordedAt: null -
   * unlike Stage I2's public endpoint, an owner managing their OWN fleet
   * wants to see every active vehicle, not just the ones that have ever
   * reported.
   */
  async getFleetPositions(actor: AuthenticatedUser): Promise<FleetVehiclePosition[]> {
    assertOwnerOrManager(actor);

    const motorcycles = await this.prisma.client.motorcycle.findMany({
      where: { isActive: true },
      select: {
        id: true,
        registrationNumber: true,
        vehicleType: true,
        trackingMode: true,
        gpsLocations: {
          orderBy: { recordedAt: 'desc' },
          take: CURRENT_POSITION_FIX_LOOKBACK,
          select: FIX_SELECT,
        },
      },
    });

    const now = new Date();
    return motorcycles.map((m): FleetVehiclePosition => {
      const resolved = resolveCurrentPosition(m.gpsLocations as GpsFixCandidate[], now);
      const base = {
        motorcycleId: m.id,
        registrationNumber: m.registrationNumber,
        vehicleType: m.vehicleType,
        trackingMode: m.trackingMode,
      };
      if (resolved.offline) {
        return {
          ...base,
          offline: true,
          lastRecordedAt: resolved.lastRecordedAt?.toISOString() ?? null,
        };
      }
      return {
        ...base,
        offline: false,
        latitude: resolved.latitude,
        longitude: resolved.longitude,
        recordedAt: resolved.recordedAt.toISOString(),
        source: resolved.source,
      };
    });
  }

  /**
   * Stage I3 (§7) - the date-picker replay for one vehicle. Ordered oldest
   * -> newest (a path is drawn in the order it was driven, unlike
   * getFleetPositions' newest-first lookback), scoped to one Africa/Dar_es_
   * Salaam calendar day via darEsSalaamDayRangeUtc - the exact inverse of
   * the day-boundary logic recordPhoneFixes above already uses.
   */
  async getVehiclePath(
    motorcycleId: string,
    dateOnlyString: string,
    actor: AuthenticatedUser,
  ): Promise<VehiclePathPoint[]> {
    assertOwnerOrManager(actor);

    const motorcycle = await this.prisma.client.motorcycle.findUnique({
      where: { id: motorcycleId },
    });
    if (!motorcycle) {
      throw new NotFoundException('Vehicle not found');
    }

    const { start, end } = darEsSalaamDayRangeUtc(dateOnlyString);
    const fixes = await this.prisma.client.gpsLocation.findMany({
      where: { motorcycleId, recordedAt: { gte: start, lt: end } },
      orderBy: { recordedAt: 'asc' },
      select: { recordedAt: true, latitude: true, longitude: true, speedKmh: true },
    });

    return fixes.map((f) => ({
      recordedAt: f.recordedAt.toISOString(),
      latitude: f.latitude,
      longitude: f.longitude,
      speedKmh: f.speedKmh,
    }));
  }
}
