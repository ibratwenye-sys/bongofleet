import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateMotorcycleDto } from './dto/create-motorcycle.dto';
import { UpdateMotorcycleDto } from './dto/update-motorcycle.dto';
import { ListMotorcyclesQueryDto } from './dto/list-motorcycles-query.dto';

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may manage motorcycles');
  }
}

@Injectable()
export class MotorcycleService {
  constructor(private readonly prisma: PrismaService) {}

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
      return await this.prisma.client.motorcycle.create({
        data: {
          tenantId: actor.tenantId,
          registrationNumber: dto.registrationNumber,
          make: dto.make,
          model: dto.model,
          year: dto.year,
          gpsDeviceId: dto.gpsDeviceId,
          status: dto.status,
        },
      });
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

    const where: Prisma.MotorcycleWhereInput = query.includeInactive ? {} : { isActive: true };

    if (query.status) {
      where.status = query.status;
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
      return await this.prisma.client.motorcycle.update({
        where: { id },
        data: {
          registrationNumber: dto.registrationNumber,
          make: dto.make,
          model: dto.model,
          year: dto.year,
          gpsDeviceId: dto.gpsDeviceId,
          status: dto.status,
        },
      });
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
  }

  async reactivate(id: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const existing = await this.prisma.client.motorcycle.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Motorcycle not found');
    }

    return this.prisma.client.motorcycle.update({
      where: { id },
      data: { isActive: true, deletedAt: null },
    });
  }
}
