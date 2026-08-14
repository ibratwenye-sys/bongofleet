import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { DRIVER_SEARCH_RESULT_LIMIT, normalizeSearchQuery } from '@bongofleet/shared-lib';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { hashPassword } from '../auth/utils/password.util';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { ListDriversQueryDto } from './dto/list-drivers-query.dto';
import { SearchDriversQueryDto } from './dto/search-drivers-query.dto';

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
} satisfies Prisma.UserSelect;

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may manage drivers');
  }
}

@Injectable()
export class DriverService {
  constructor(private readonly prisma: PrismaService) {}

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
    const where: Prisma.DriverWhereInput = {
      isActive: true,
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

    const plateByDriverId = await this.currentPlatesByDriverId(page.map((driver) => driver.id));

    return {
      results: page.map((driver) => ({
        id: driver.id,
        firstName: driver.user.firstName,
        lastName: driver.user.lastName,
        phone: driver.user.phone,
        registrationNumber: plateByDriverId.get(driver.id) ?? null,
      })),
      hasMore,
    };
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

    return { ...driver, user };
  }
}
