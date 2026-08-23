import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Motorcycle, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantCacheService } from '../../cache/tenant-cache.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateMotorcycleDto } from './dto/create-motorcycle.dto';
import { UpdateMotorcycleDto } from './dto/update-motorcycle.dto';
import { ListMotorcyclesQueryDto } from './dto/list-motorcycles-query.dto';

const CACHE_RESOURCE = 'motorcycles';
// The only cached shape is the plain, unfiltered, active-only list - the
// common case (dashboard/list page load) and the one every write below can
// invalidate with a single exact key. A status/vehicleType/search/
// includeInactive query bypasses the cache entirely rather than caching
// every filter combination - see list() below.
const CACHE_PARAMS = 'default';

function isDefaultQuery(query: ListMotorcyclesQueryDto): boolean {
  return !query.includeInactive && !query.status && !query.vehicleType && !query.search;
}

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may manage motorcycles');
  }
}

@Injectable()
export class MotorcycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TenantCacheService,
  ) {}

  private invalidateList(tenantId: string): Promise<void> {
    return this.cache.invalidate(tenantId, CACHE_RESOURCE, CACHE_PARAMS);
  }

  async create(dto: CreateMotorcycleDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const duplicateRegistration = await this.prisma.client.motorcycle.findFirst({
      where: { registrationNumber: dto.registrationNumber },
    });
    if (duplicateRegistration) {
      throw new ConflictException('A motorcycle with this registration number already exists');
    }

    if (dto.gpsDeviceId) {
      const duplicateGps = await this.prisma.client.motorcycle.findFirst({
        where: { gpsDeviceId: dto.gpsDeviceId },
      });
      if (duplicateGps) {
        throw new ConflictException('A motorcycle with this GPS device ID already exists');
      }
    }

    try {
      const created = await this.prisma.client.motorcycle.create({
        data: {
          tenantId: actor.tenantId,
          registrationNumber: dto.registrationNumber,
          vehicleType: dto.vehicleType,
          make: dto.make,
          model: dto.model,
          year: dto.year,
          gpsDeviceId: dto.gpsDeviceId,
          chassisNumber: dto.chassisNumber,
          colour: dto.colour,
          status: dto.status,
        },
      });
      await this.invalidateList(actor.tenantId);
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'A motorcycle with this registration number or GPS device ID already exists',
        );
      }
      throw error;
    }
  }

  async list(query: ListMotorcyclesQueryDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    if (isDefaultQuery(query)) {
      const cached = await this.cache.get<Motorcycle[]>(
        actor.tenantId,
        CACHE_RESOURCE,
        CACHE_PARAMS,
      );
      if (cached) {
        return cached;
      }

      const list = await this.prisma.client.motorcycle.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      await this.cache.set(actor.tenantId, CACHE_RESOURCE, CACHE_PARAMS, list);
      return list;
    }

    const where: Prisma.MotorcycleWhereInput = query.includeInactive ? {} : { isActive: true };

    if (query.status) {
      where.status = query.status;
    }

    if (query.vehicleType) {
      where.vehicleType = query.vehicleType;
    }

    if (query.search) {
      where.registrationNumber = { contains: query.search, mode: 'insensitive' };
    }

    return this.prisma.client.motorcycle.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async get(id: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const motorcycle = await this.prisma.client.motorcycle.findUnique({ where: { id } });
    if (!motorcycle) {
      throw new NotFoundException('Motorcycle not found');
    }

    return motorcycle;
  }

  async update(id: string, dto: UpdateMotorcycleDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const existing = await this.prisma.client.motorcycle.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Motorcycle not found');
    }

    if (dto.registrationNumber && dto.registrationNumber !== existing.registrationNumber) {
      const duplicate = await this.prisma.client.motorcycle.findFirst({
        where: { registrationNumber: dto.registrationNumber },
      });
      if (duplicate) {
        throw new ConflictException('A motorcycle with this registration number already exists');
      }
    }

    if (dto.gpsDeviceId && dto.gpsDeviceId !== existing.gpsDeviceId) {
      const duplicate = await this.prisma.client.motorcycle.findFirst({
        where: { gpsDeviceId: dto.gpsDeviceId },
      });
      if (duplicate) {
        throw new ConflictException('A motorcycle with this GPS device ID already exists');
      }
    }

    try {
      const updated = await this.prisma.client.motorcycle.update({
        where: { id },
        data: {
          registrationNumber: dto.registrationNumber,
          vehicleType: dto.vehicleType,
          make: dto.make,
          model: dto.model,
          year: dto.year,
          gpsDeviceId: dto.gpsDeviceId,
          chassisNumber: dto.chassisNumber,
          colour: dto.colour,
          status: dto.status,
        },
      });
      await this.invalidateList(actor.tenantId);
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'A motorcycle with this registration number or GPS device ID already exists',
        );
      }
      throw error;
    }
  }

  async deactivate(id: string, actor: AuthenticatedUser): Promise<void> {
    assertOwnerOrManager(actor);

    const existing = await this.prisma.client.motorcycle.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Motorcycle not found');
    }

    await this.prisma.client.motorcycle.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });
    await this.invalidateList(actor.tenantId);
  }

  async reactivate(id: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const existing = await this.prisma.client.motorcycle.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Motorcycle not found');
    }

    const reactivated = await this.prisma.client.motorcycle.update({
      where: { id },
      data: { isActive: true, deletedAt: null },
    });
    await this.invalidateList(actor.tenantId);
    return reactivated;
  }
}
