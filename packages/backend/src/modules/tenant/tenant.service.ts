import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantCacheService } from '../../cache/tenant-cache.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';

function assertOwner(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER) {
    throw new ForbiddenException('Only OWNER may view or change tenant settings');
  }
}

const CACHE_RESOURCE = 'tenant-settings';
// No filters exist on this lookup at all - one tenant, one settings object -
// so unlike the list endpoints above there is no "default vs filtered" split
// to make; every call is cacheable.
const CACHE_PARAMS = 'default';

export interface TenantSettings {
  name: string;
  physicalAddress: string | null;
  directorName: string | null;
}

/**
 * Stage G Part 2. Tenant is the one model excluded from the tenant-scoping
 * Prisma extension (see tenant-scoping.extension.ts) - it IS the tenant
 * boundary, not a row scoped within one - so every query here filters by
 * actor.tenantId explicitly rather than relying on that extension. There is
 * no route parameter identifying which tenant: the DTO carries no id, and
 * the service only ever reads/writes actor.tenantId, so there is no other
 * tenant's row this endpoint can reach in the first place - a missing or
 * anomalous own-tenant row (never expected in practice) is a NotFound, the
 * same "unknown or someone else's" shape used everywhere else in this
 * codebase, never a Forbidden that would confirm anything about another id.
 */
@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TenantCacheService,
  ) {}

  async getSettings(actor: AuthenticatedUser): Promise<TenantSettings> {
    assertOwner(actor);

    const cached = await this.cache.get<TenantSettings>(
      actor.tenantId,
      CACHE_RESOURCE,
      CACHE_PARAMS,
    );
    if (cached) {
      return cached;
    }

    const tenant = await this.prisma.client.tenant.findUnique({ where: { id: actor.tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const settings: TenantSettings = {
      name: tenant.name,
      physicalAddress: tenant.physicalAddress,
      directorName: tenant.directorName,
    };
    await this.cache.set(actor.tenantId, CACHE_RESOURCE, CACHE_PARAMS, settings);
    return settings;
  }

  async updateSettings(
    dto: UpdateTenantSettingsDto,
    actor: AuthenticatedUser,
  ): Promise<TenantSettings> {
    assertOwner(actor);

    const existing = await this.prisma.client.tenant.findUnique({
      where: { id: actor.tenantId },
    });
    if (!existing) {
      throw new NotFoundException('Tenant not found');
    }

    const tenant = await this.prisma.client.tenant.update({
      where: { id: actor.tenantId },
      data: {
        physicalAddress: dto.physicalAddress,
        directorName: dto.directorName,
      },
    });

    const settings: TenantSettings = {
      name: tenant.name,
      physicalAddress: tenant.physicalAddress,
      directorName: tenant.directorName,
    };
    await this.cache.invalidate(actor.tenantId, CACHE_RESOURCE, CACHE_PARAMS);
    return settings;
  }
}
