import { Injectable, NotFoundException } from '@nestjs/common';
import { GpsSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { requestContext } from '../../common/context/request-context';
import { computeLinkStatus } from './tracking-link.service';
import {
  CURRENT_POSITION_FIX_LOOKBACK,
  resolveCurrentPosition,
  type GpsFixCandidate,
} from '../gps/current-position';

/**
 * Stage I2 (DESIGN_GPS_TRACKING.md §8). Built by field-by-field construction
 * ONLY, never `{ ...someRow }` and never a wide select/include - see this
 * stage's own instructions, written after DM4's passwordHash leak through
 * exactly that shortcut. Every field here is deliberately safe to hand to a
 * stranger with no login: no rider name/phone, no money figures, no other
 * tenant's data, not even this tenant's own name.
 */
export type PublicVehiclePosition =
  | {
      registrationNumber: string;
      offline: false;
      latitude: number;
      longitude: number;
      recordedAt: string;
      source: GpsSource;
    }
  | {
      registrationNumber: string;
      offline: true;
      lastKnownAt: string | null;
    };

function toPublicPosition(registrationNumber: string, fixes: GpsFixCandidate[], now: Date) {
  const resolved = resolveCurrentPosition(fixes, now);
  if (resolved.offline) {
    return {
      registrationNumber,
      offline: true,
      lastKnownAt: resolved.lastRecordedAt?.toISOString() ?? null,
    } satisfies PublicVehiclePosition;
  }
  return {
    registrationNumber,
    offline: false,
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    recordedAt: resolved.recordedAt.toISOString(),
    source: resolved.source,
  } satisfies PublicVehiclePosition;
}

const FIX_SELECT = { source: true, latitude: true, longitude: true, recordedAt: true } as const;

@Injectable()
export class TrackingLinkPublicService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * No JWT, no tenant context (see TrackingLinkPublicController - no guards
   * at all), so every Prisma call below runs inside requestContext.
   * runUnscoped() and filters by tenantId explicitly itself - the
   * tenant-scoping extension has nothing to attach to here, the same
   * reason this codebase's own test utilities use runUnscoped outside a
   * request.
   *
   * A nonexistent token, an expired one, and a revoked one all produce the
   * identical NotFoundException below - same reasoning as this codebase's
   * cross-tenant 404-not-403 convention: the response must not tell a
   * caller which of the three they hit.
   */
  async getByToken(token: string): Promise<PublicVehiclePosition | PublicVehiclePosition[]> {
    return requestContext.runUnscoped(async () => {
      const link = await this.prisma.client.trackingLink.findUnique({ where: { token } });
      const now = new Date();
      if (!link || computeLinkStatus(link.revokedAt, link.expiresAt, now) !== 'ACTIVE') {
        throw new NotFoundException('Tracking link not found');
      }

      await this.prisma.client.trackingLink.update({
        where: { id: link.id },
        data: { viewCount: { increment: 1 }, lastViewedAt: now },
      });

      if (link.motorcycleId) {
        // Explicit tenantId in the where clause, not just id - the FK from
        // TrackingLink.motorcycleId already guarantees this motorcycle
        // belongs to link.tenantId (Motorcycle rows are never reassigned
        // between tenants), but this runs with NO tenant-scoping extension
        // active at all, so the check is written out here rather than
        // relied on implicitly.
        const motorcycle = await this.prisma.client.motorcycle.findFirst({
          where: { id: link.motorcycleId, tenantId: link.tenantId },
          select: {
            registrationNumber: true,
            gpsLocations: {
              orderBy: { recordedAt: 'desc' },
              take: CURRENT_POSITION_FIX_LOOKBACK,
              select: FIX_SELECT,
            },
          },
        });
        if (!motorcycle) {
          // The referenced vehicle is gone from under an otherwise-valid
          // link - onDelete: Restrict makes this practically unreachable
          // today, but the response shape must still make sense if it ever
          // happens, and "not found" is the honest answer, not a 500.
          throw new NotFoundException('Tracking link not found');
        }
        return toPublicPosition(motorcycle.registrationNumber, motorcycle.gpsLocations, now);
      }

      // Whole-fleet: every motorcycle in this tenant that has EVER reported
      // a fix, per §8 - not just the ones currently online. A vehicle with
      // only stale fixes still appears, marked offline with its last-known
      // age (resolveCurrentPosition handles that itself).
      const motorcycles = await this.prisma.client.motorcycle.findMany({
        where: { tenantId: link.tenantId, gpsLocations: { some: {} } },
        select: {
          registrationNumber: true,
          gpsLocations: {
            orderBy: { recordedAt: 'desc' },
            take: CURRENT_POSITION_FIX_LOOKBACK,
            select: FIX_SELECT,
          },
        },
      });
      return motorcycles.map((m) => toPublicPosition(m.registrationNumber, m.gpsLocations, now));
    });
  }
}
