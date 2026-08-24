import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantCacheService } from '../../cache/tenant-cache.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { estimatedMonthlyTotal, resolvePricingTier } from './subscription-pricing';

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

// Stage SUB1 - a separate resource from CACHE_RESOURCE above: GET
// /tenant/billing is a different endpoint with its own read shape, cached
// independently (see getBilling below) rather than folded into
// tenant-settings, which nothing about billing actually depends on.
const BILLING_CACHE_RESOURCE = 'tenant-billing';
const BILLING_CACHE_PARAMS = 'default';

export interface TenantBilling {
  activeBikeCount: number;
  pricePerBikePerMonth: string;
  estimatedMonthlyTotal: string;
  status: TenantStatus;
  trialEndsAt: string | null;
  billingExempt: boolean;
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

  /**
   * Stage SUB1 (DESIGN_SUBSCRIPTION.md §5b). What the dashboard's billing
   * page reads. Deliberately does NOT charge or reserve anything - actual
   * charge collection is still blocked on AzamPay (§8 step 4); this is a
   * read-only estimate.
   */
  async getBilling(actor: AuthenticatedUser): Promise<TenantBilling> {
    assertOwner(actor);

    const cached = await this.cache.get<TenantBilling>(
      actor.tenantId,
      BILLING_CACHE_RESOURCE,
      BILLING_CACHE_PARAMS,
    );
    if (cached) {
      return cached;
    }

    const tenant = await this.prisma.client.tenant.findUnique({ where: { id: actor.tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // Motorcycle is tenant-scoped by the Prisma extension (unlike Tenant and
    // SubscriptionPricingTier above/below) - this count is implicitly
    // filtered to actor.tenantId, same as every other Motorcycle query in
    // this codebase.
    const activeBikeCount = await this.prisma.client.motorcycle.count({
      where: { isActive: true },
    });

    // SubscriptionPricingTier is BongoFleet's own global platform pricing,
    // excluded from tenant scoping (see its schema.prisma comment) - every
    // tenant resolves against the same rows.
    const tiers = await this.prisma.client.subscriptionPricingTier.findMany();
    const tier = resolvePricingTier(tiers, activeBikeCount, new Date());
    const total = estimatedMonthlyTotal(tier.pricePerBikePerMonth, activeBikeCount);

    const billing: TenantBilling = {
      activeBikeCount,
      pricePerBikePerMonth: tier.pricePerBikePerMonth.toFixed(2),
      estimatedMonthlyTotal: total.toFixed(2),
      status: tenant.status,
      trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
      billingExempt: tenant.billingExemptAt !== null,
    };
    await this.cache.set(actor.tenantId, BILLING_CACHE_RESOURCE, BILLING_CACHE_PARAMS, billing);
    return billing;
  }
}
