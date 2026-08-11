import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';

function assertOwner(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER) {
    throw new ForbiddenException('Only OWNER may view or change tenant settings');
  }
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
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(actor: AuthenticatedUser) {
    assertOwner(actor);

    const tenant = await this.prisma.client.tenant.findUnique({ where: { id: actor.tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return {
      name: tenant.name,
      physicalAddress: tenant.physicalAddress,
      directorName: tenant.directorName,
    };
  }

  async updateSettings(dto: UpdateTenantSettingsDto, actor: AuthenticatedUser) {
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

    return {
      name: tenant.name,
      physicalAddress: tenant.physicalAddress,
      directorName: tenant.directorName,
    };
  }
}
