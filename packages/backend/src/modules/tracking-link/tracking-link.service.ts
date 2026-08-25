import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TrackingLink, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { generateTrackingToken } from '../../common/tracking-token.util';
import { CreateTrackingLinkDto } from './dto/create-tracking-link.dto';

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may manage tracking links');
  }
}

export type TrackingLinkStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface TrackingLinkView extends TrackingLink {
  status: TrackingLinkStatus;
}

/** §8: "should default to an expiry date rather than never" - enforced here,
 *  not just in the dashboard's date picker, since a frontend default is
 *  trivially bypassed by calling the API directly. */
const DEFAULT_EXPIRY_DAYS = 7;

const MAX_TOKEN_COLLISION_ATTEMPTS = 5;

export function computeLinkStatus(
  revokedAt: Date | null,
  expiresAt: Date | null,
  now: Date = new Date(),
): TrackingLinkStatus {
  if (revokedAt !== null) {
    return 'REVOKED';
  }
  if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) {
    return 'EXPIRED';
  }
  return 'ACTIVE';
}

function withStatus(link: TrackingLink, now: Date = new Date()): TrackingLinkView {
  return { ...link, status: computeLinkStatus(link.revokedAt, link.expiresAt, now) };
}

@Injectable()
export class TrackingLinkService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTrackingLinkDto, actor: AuthenticatedUser): Promise<TrackingLinkView> {
    assertOwnerOrManager(actor);

    if (dto.motorcycleId) {
      const motorcycle = await this.prisma.client.motorcycle.findUnique({
        where: { id: dto.motorcycleId },
      });
      if (!motorcycle) {
        throw new NotFoundException('Vehicle not found');
      }
    }

    // See CreateTrackingLinkDto.expiresAt's comment - undefined (omitted)
    // gets the default; null (explicit) means "never expires"; a string
    // becomes that Date.
    let expiresAt: Date | null;
    if (dto.expiresAt === undefined) {
      expiresAt = new Date();
      expiresAt.setUTCDate(expiresAt.getUTCDate() + DEFAULT_EXPIRY_DAYS);
    } else {
      expiresAt = dto.expiresAt === null ? null : new Date(dto.expiresAt);
    }

    // Retry only on the (astronomically rare) token collision - same pattern
    // as generateRideReference()'s call sites (e.g. assignment.service.ts).
    for (let attempt = 0; ; attempt += 1) {
      try {
        const created = await this.prisma.client.trackingLink.create({
          data: {
            tenantId: actor.tenantId,
            motorcycleId: dto.motorcycleId ?? null,
            token: generateTrackingToken(),
            label: dto.label,
            expiresAt,
            createdByUserId: actor.userId,
          },
        });
        return withStatus(created);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const target = error.meta?.target;
          const tokenCollision = Array.isArray(target)
            ? target.some((t) => String(t).includes('token'))
            : String(target ?? '').includes('token');
          if (tokenCollision && attempt < MAX_TOKEN_COLLISION_ATTEMPTS) {
            continue;
          }
        }
        throw error;
      }
    }
  }

  async list(actor: AuthenticatedUser): Promise<TrackingLinkView[]> {
    assertOwnerOrManager(actor);

    const links = await this.prisma.client.trackingLink.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return links.map((link) => withStatus(link, now));
  }

  /** Idempotent: revoking an already-revoked link returns its existing
   *  (unchanged) revokedAt rather than erroring or overwriting it with a
   *  new timestamp - see the model's own schema comment on revokedAt. */
  async revoke(id: string, actor: AuthenticatedUser): Promise<TrackingLinkView> {
    assertOwnerOrManager(actor);

    const existing = await this.prisma.client.trackingLink.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Tracking link not found');
    }

    if (existing.revokedAt !== null) {
      return withStatus(existing);
    }

    const revoked = await this.prisma.client.trackingLink.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return withStatus(revoked);
  }
}
