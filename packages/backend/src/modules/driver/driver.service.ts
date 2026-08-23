import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OwnershipPlanStatus, Prisma, UserRole } from '@prisma/client';
import { DRIVER_SEARCH_RESULT_LIMIT, normalizeSearchQuery } from '@bongofleet/shared-lib';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantCacheService } from '../../cache/tenant-cache.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { hashPassword } from '../auth/utils/password.util';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { ListDriversQueryDto } from './dto/list-drivers-query.dto';
import { SearchDriversQueryDto } from './dto/search-drivers-query.dto';

const CACHE_RESOURCE = 'drivers';
// Same reasoning as motorcycle.service.ts's CACHE_PARAMS: only the plain,
// unfiltered, active-only list is cached; a search/includeInactive query
// bypasses the cache entirely.
const CACHE_PARAMS = 'default';

function isDefaultQuery(query: ListDriversQueryDto): boolean {
  return !query.includeInactive && !query.search;
}

export interface DriverSearchResult {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  /** The vehicle on this driver's most recent DailyAssignment, regardless of
   *  whether that's what matched the query - a result matched by name still
   *  needs to show the plate, or it can't do its one job: telling three
   *  Jumas apart. Null if this driver has never been assigned a vehicle. */
  registrationNumber: string | null;
  /** Stage DS1 - present so a call site that opts into includeInactive can
   *  render an "Inactive" badge; default (includeInactive=false) callers
   *  never see false here since inactive drivers are filtered out already. */
  isActive: boolean;
}

export interface DriverSearchResponse {
  results: DriverSearchResult[];
  /** True if more drivers matched than were returned - the UI must say so,
   *  never truncate silently. */
  hasMore: boolean;
}

const SAFE_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  isActive: true,
  // Stage H0f Part 2 - so the dashboard can tell an owner whether this rider can
  // get back in on his own, or whether the owner is his only route.
  emailProvenAt: true,
} satisfies Prisma.UserSelect;

type DriverListItem = Prisma.DriverGetPayload<{
  include: { user: { select: typeof SAFE_USER_SELECT } };
}>;

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may manage drivers');
  }
}

@Injectable()
export class DriverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TenantCacheService,
  ) {}

  private invalidateList(tenantId: string): Promise<void> {
    return this.cache.invalidate(tenantId, CACHE_RESOURCE, CACHE_PARAMS);
  }

  async create(dto: CreateDriverDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const duplicateEmail = await this.prisma.client.user.findFirst({
      where: { email: dto.email },
    });
    if (duplicateEmail) {
      throw new ConflictException('A user with this email already exists');
    }

    const duplicatePhone = await this.prisma.client.user.findFirst({
      where: { phone: dto.phone },
    });
    if (duplicatePhone) {
      throw new ConflictException('A user with this phone number already exists');
    }

    const duplicateLicense = await this.prisma.client.driver.findFirst({
      where: { licenseNumber: dto.licenseNumber },
    });
    if (duplicateLicense) {
      throw new ConflictException('A driver with this license number already exists');
    }

    const passwordHash = await hashPassword(dto.initialPassword);

    try {
      const { driver, user } = await this.prisma.client.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            tenantId: actor.tenantId,
            email: dto.email,
            phone: dto.phone,
            passwordHash,
            role: UserRole.RIDER,
            firstName: dto.firstName,
            lastName: dto.lastName,
            isActive: true,
          },
          select: SAFE_USER_SELECT,
        });

        const driver = await tx.driver.create({
          data: {
            tenantId: actor.tenantId,
            userId: user.id,
            licenseNumber: dto.licenseNumber,
            nationalId: dto.nationalId,
            emergencyContact: dto.emergencyContact,
            residenceWard: dto.residenceWard,
            residenceDistrict: dto.residenceDistrict,
            residenceRegion: dto.residenceRegion,
            driverType: dto.driverType,
          },
        });

        return { driver, user };
      });

      await this.invalidateList(actor.tenantId);
      return { ...driver, user };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'A user or driver with this email, phone, or license number already exists',
        );
      }
      throw error;
    }
  }

  async list(query: ListDriversQueryDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    if (isDefaultQuery(query)) {
      const cached = await this.cache.get<DriverListItem[]>(
        actor.tenantId,
        CACHE_RESOURCE,
        CACHE_PARAMS,
      );
      if (cached) {
        return cached;
      }

      const list = await this.fetchDefaultList();
      await this.cache.set(actor.tenantId, CACHE_RESOURCE, CACHE_PARAMS, list);
      return list;
    }

    const where: Prisma.DriverWhereInput = query.includeInactive ? {} : { isActive: true };

    if (query.search) {
      where.OR = [
        { licenseNumber: { contains: query.search, mode: 'insensitive' } },
        { user: { firstName: { contains: query.search, mode: 'insensitive' } } },
        { user: { lastName: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    return this.prisma.client.driver.findMany({
      where,
      include: { user: { select: SAFE_USER_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private fetchDefaultList() {
    return this.prisma.client.driver.findMany({
      where: { isActive: true },
      include: { user: { select: SAFE_USER_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Stage G6 Part 2 - the searchable driver picker's backing query. Matches
   * name, phone, and current vehicle plate; tenant scoping is automatic (the
   * Prisma tenant-scoping extension merges tenantId into every where clause
   * going through this.prisma.client - see prisma/extensions), so a search
   * can never surface another owner's driver, and an unknown/wrong-tenant id
   * elsewhere in this module already 404s rather than 403ing - same rule.
   *
   * The query is split into whitespace tokens and every token must match
   * SOME field (name OR phone OR plate) - a single-token query behaves like
   * a plain OR across all three (independent matching), and a multi-token
   * query like "Juma Bakari" requires each word to land somewhere, which is
   * what typing a full name actually needs.
   *
   * Stage DS1 - `includeInactive` defaults to false (today's behaviour).
   * Plate matching also folds in each token's match against every ACTIVE
   * ownership plan's vehicle, not just dailyAssignments - see
   * activePlanPlateIndex.
   */
  async search(
    query: SearchDriversQueryDto,
    actor: AuthenticatedUser,
  ): Promise<DriverSearchResponse> {
    assertOwnerOrManager(actor);

    const q = normalizeSearchQuery(query.q);
    const limit = query.limit ?? DRIVER_SEARCH_RESULT_LIMIT;
    if (!q) {
      return { results: [], hasMore: false };
    }

    const tokens = q.split(' ');
    const { driverIdsByToken: planDriverIdsByToken, plateByDriverId: planPlateByDriverId } =
      await this.activePlanPlateIndex(tokens);

    const where: Prisma.DriverWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      AND: tokens.map((token) => ({
        OR: [
          { user: { firstName: { contains: token, mode: 'insensitive' } } },
          { user: { lastName: { contains: token, mode: 'insensitive' } } },
          { user: { phone: { contains: token, mode: 'insensitive' } } },
          {
            dailyAssignments: {
              some: {
                motorcycle: { registrationNumber: { contains: token, mode: 'insensitive' } },
              },
            },
          },
          { id: { in: planDriverIdsByToken.get(token) ?? [] } },
        ],
      })),
    };

    // take limit+1, never limit - the extra row is how hasMore is known
    // without a second count() query.
    const candidates = await this.prisma.client.driver.findMany({
      where,
      include: { user: { select: SAFE_USER_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = candidates.length > limit;
    const page = candidates.slice(0, limit);

    const assignmentPlateByDriverId = await this.currentPlatesByDriverId(
      page.map((driver) => driver.id),
    );

    return {
      results: page.map((driver) => ({
        id: driver.id,
        firstName: driver.user.firstName,
        lastName: driver.user.lastName,
        phone: driver.user.phone,
        isActive: driver.isActive,
        // Stage DS1 - a driver matched via their plan's plate (no assignment
        // yet) must not display "no vehicle on file"; that would defeat the
        // point of having matched them by plate at all. Falls back to the
        // plan's vehicle only when no assignment plate exists - an
        // assignment reflects the vehicle actually driven, which should win
        // when both are on file.
        registrationNumber:
          assignmentPlateByDriverId.get(driver.id) ?? planPlateByDriverId.get(driver.id) ?? null,
      })),
      hasMore,
    };
  }

  /**
   * Stage DS1 - a driver on a brand-new hire-purchase plan has no
   * DailyAssignment row until the nightly OwnershipPlanGeneratorService cron
   * creates the first instalment, so the dailyAssignments `some` clause
   * above can't find them same-day. OwnershipPlan.driverId/motorcycleId are
   * plain scalar FKs with no declared Prisma relation to Driver/Motorcycle
   * (same convention as guarantorId - confirmed against schema.prisma), so
   * this can't be expressed as a nested `some` inside driver.findMany()'s
   * own where clause.
   *
   * Two fixed-count queries regardless of driver/plan/token count - the
   * same batching discipline as currentPlatesByDriverId below - fetch every
   * ACTIVE plan's (driverId, motorcycleId), resolve those vehicles' plates
   * in one follow-up query, then match tokens against plates in memory.
   * Returns both the per-token match (for the where-clause) and a plain
   * driverId->plate map (so a plan-only match can still display its plate -
   * see the registrationNumber fallback in search() above).
   */
  private async activePlanPlateIndex(
    tokens: string[],
  ): Promise<{ driverIdsByToken: Map<string, string[]>; plateByDriverId: Map<string, string> }> {
    const activePlans = await this.prisma.client.ownershipPlan.findMany({
      where: { status: OwnershipPlanStatus.ACTIVE },
      select: { driverId: true, motorcycleId: true },
    });

    const driverIdsByToken = new Map<string, string[]>(tokens.map((token) => [token, []]));
    if (activePlans.length === 0) {
      return { driverIdsByToken, plateByDriverId: new Map() };
    }

    const motorcycles = await this.prisma.client.motorcycle.findMany({
      where: { id: { in: activePlans.map((plan) => plan.motorcycleId) } },
      select: { id: true, registrationNumber: true },
    });
    const plateByMotorcycleId = new Map(motorcycles.map((m) => [m.id, m.registrationNumber]));

    const planPlates = activePlans
      .map((plan) => ({
        driverId: plan.driverId,
        plate: plateByMotorcycleId.get(plan.motorcycleId),
      }))
      .filter((entry): entry is { driverId: string; plate: string } => entry.plate !== undefined);

    for (const token of tokens) {
      const lowerToken = token.toLowerCase();
      driverIdsByToken.set(
        token,
        planPlates
          .filter((entry) => entry.plate.toLowerCase().includes(lowerToken))
          .map((entry) => entry.driverId),
      );
    }

    const plateByDriverId = new Map(planPlates.map((entry) => [entry.driverId, entry.plate]));
    return { driverIdsByToken, plateByDriverId };
  }

  /**
   * One query for the whole batch, not one per driver - a picker rendering
   * ten results must not issue ten more queries to label them. `distinct`
   * needs assignedDate DESC ordered within each driverId group to keep the
   * most recent row per driver (Prisma keeps the first row per distinct key
   * in orderBy order).
   */
  private async currentPlatesByDriverId(driverIds: string[]): Promise<Map<string, string>> {
    if (driverIds.length === 0) {
      return new Map();
    }
    const assignments = await this.prisma.client.dailyAssignment.findMany({
      where: { driverId: { in: driverIds } },
      orderBy: [{ driverId: 'asc' }, { assignedDate: 'desc' }],
      distinct: ['driverId'],
      select: { driverId: true, motorcycle: { select: { registrationNumber: true } } },
    });
    return new Map(assignments.map((a) => [a.driverId, a.motorcycle.registrationNumber]));
  }

  async get(id: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const driver = await this.prisma.client.driver.findUnique({
      where: { id },
      include: { user: { select: SAFE_USER_SELECT } },
    });
    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    return driver;
  }

  async update(id: string, dto: UpdateDriverDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const existing = await this.prisma.client.driver.findUnique({
      where: { id },
      include: { user: { select: SAFE_USER_SELECT } },
    });
    if (!existing) {
      throw new NotFoundException('Driver not found');
    }

    if (dto.phone && dto.phone !== existing.user.phone) {
      const duplicate = await this.prisma.client.user.findFirst({ where: { phone: dto.phone } });
      if (duplicate) {
        throw new ConflictException('A user with this phone number already exists');
      }
    }

    if (dto.licenseNumber && dto.licenseNumber !== existing.licenseNumber) {
      const duplicate = await this.prisma.client.driver.findFirst({
        where: { licenseNumber: dto.licenseNumber },
      });
      if (duplicate) {
        throw new ConflictException('A driver with this license number already exists');
      }
    }

    try {
      const { driver, user } = await this.prisma.client.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id: existing.userId },
          data: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
          },
          select: SAFE_USER_SELECT,
        });

        const driver = await tx.driver.update({
          where: { id },
          data: {
            licenseNumber: dto.licenseNumber,
            nationalId: dto.nationalId,
            emergencyContact: dto.emergencyContact,
            residenceWard: dto.residenceWard,
            residenceDistrict: dto.residenceDistrict,
            residenceRegion: dto.residenceRegion,
            driverType: dto.driverType,
          },
        });

        return { driver, user };
      });

      await this.invalidateList(actor.tenantId);
      return { ...driver, user };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'A user or driver with this phone number or license number already exists',
        );
      }
      throw error;
    }
  }

  async deactivate(id: string, actor: AuthenticatedUser): Promise<void> {
    assertOwnerOrManager(actor);

    const existing = await this.prisma.client.driver.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Driver not found');
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.driver.update({
        where: { id },
        data: { isActive: false, deletedAt: new Date() },
      });
      await tx.user.update({
        where: { id: existing.userId },
        data: { isActive: false },
      });
    });
    await this.invalidateList(actor.tenantId);
  }

  async reactivate(id: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const existing = await this.prisma.client.driver.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Driver not found');
    }

    const { driver, user } = await this.prisma.client.$transaction(async (tx) => {
      const driver = await tx.driver.update({
        where: { id },
        data: { isActive: true, deletedAt: null },
      });
      const user = await tx.user.update({
        where: { id: existing.userId },
        data: { isActive: true },
        select: SAFE_USER_SELECT,
      });
      return { driver, user };
    });

    await this.invalidateList(actor.tenantId);
    return { ...driver, user };
  }
}
