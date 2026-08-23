import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';

// Stage: Redis caching layer. 30-60s is the checklist's own window for this
// kind of read-heavy, rarely-changing data - long enough to actually absorb
// repeat reads, short enough that a missed invalidation self-heals fast.
export const TENANT_CACHE_TTL_MS = 45_000;

/**
 * The only way anything in this app is allowed to read or write the shared
 * cache. Deliberately NOT the built-in CacheInterceptor: that keys off the
 * request URL by default, and in a multi-tenant app GET /motorcycles is the
 * same URL for every tenant - the exact cross-tenant leak the fail-closed
 * Prisma tenant-scoping extension exists to prevent everywhere else (see
 * tenant-scoping.extension.ts). Every key here is built from an explicit
 * tenantId, never inferred from the request, so there is no path from
 * "someone forgot a where clause" to "tenant B saw tenant A's list."
 *
 * Callers pass `params` themselves rather than this service inspecting a
 * request - see each call site for what "params" means for that resource
 * (usually a fixed sentinel like 'default', since filtered/searched list
 * calls deliberately bypass the cache entirely rather than caching every
 * filter combination - see motorcycle.service.ts / driver.service.ts).
 */
@Injectable()
export class TenantCacheService {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  private buildKey(tenantId: string, resource: string, params: string): string {
    return `tenant:${tenantId}:${resource}:${params}`;
  }

  async get<T>(tenantId: string, resource: string, params: string): Promise<T | undefined> {
    return this.cache.get<T>(this.buildKey(tenantId, resource, params));
  }

  async set<T>(
    tenantId: string,
    resource: string,
    params: string,
    value: T,
    ttlMs: number = TENANT_CACHE_TTL_MS,
  ): Promise<void> {
    await this.cache.set(this.buildKey(tenantId, resource, params), value, ttlMs);
  }

  async invalidate(tenantId: string, resource: string, params: string): Promise<void> {
    await this.cache.del(this.buildKey(tenantId, resource, params));
  }
}
