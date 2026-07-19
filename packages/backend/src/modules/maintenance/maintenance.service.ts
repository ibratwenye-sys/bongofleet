import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { buildDateRangeFilter } from '../expense/expense.service';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto';
import { ListMaintenanceQueryDto } from './dto/list-maintenance-query.dto';

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may manage maintenance');
  }
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

@Injectable()
export class MaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  private async getMotorcycle(motorcycleId: string) {
    const motorcycle = await this.prisma.client.motorcycle.findUnique({
      where: { id: motorcycleId },
    });
    if (!motorcycle) {
      throw new NotFoundException('Motorcycle not found');
    }
    return motorcycle;
  }

  private async assertMechanic(mechanicId: string): Promise<void> {
    const mechanic = await this.prisma.client.user.findUnique({ where: { id: mechanicId } });
    if (!mechanic) {
      throw new NotFoundException('Mechanic not found');
    }
    if (mechanic.role !== UserRole.MECHANIC) {
      throw new BadRequestException('Assigned user is not a mechanic');
    }
  }

  async create(dto: CreateMaintenanceDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    const motorcycle = await this.getMotorcycle(dto.motorcycleId);
    if (dto.mechanicId) {
      await this.assertMechanic(dto.mechanicId);
    }

    const log = await this.prisma.client.maintenanceLog.create({
      data: {
        tenantId: actor.tenantId,
        motorcycleId: dto.motorcycleId,
        mechanicId: dto.mechanicId,
        description: dto.description,
        cost: dto.cost,
        performedAt: toDate(dto.performedAt),
        mileageAtService: dto.mileageAtService,
        nextServiceDate: dto.nextServiceDate ? toDate(dto.nextServiceDate) : undefined,
        nextServiceMileage: dto.nextServiceMileage,
      },
    });

    // Keep the bike's odometer current: a service records the reading at the
    // time, so bump currentMileage if this reading is higher than what's stored.
    if (dto.mileageAtService != null && dto.mileageAtService > motorcycle.currentMileage) {
      await this.prisma.client.motorcycle.update({
        where: { id: motorcycle.id },
        data: { currentMileage: dto.mileageAtService },
      });
    }

    return log;
  }

  async list(query: ListMaintenanceQueryDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    const performedAt = buildDateRangeFilter(query.from, query.to);
    return this.prisma.client.maintenanceLog.findMany({
      where: {
        ...(query.motorcycleId ? { motorcycleId: query.motorcycleId } : {}),
        ...(performedAt ? { performedAt } : {}),
      },
      orderBy: { performedAt: 'desc' },
    });
  }

  async get(id: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    const log = await this.prisma.client.maintenanceLog.findUnique({ where: { id } });
    if (!log) {
      throw new NotFoundException('Maintenance record not found');
    }
    return log;
  }

  async update(id: string, dto: UpdateMaintenanceDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    const existing = await this.get(id, actor);
    if (dto.mechanicId) {
      await this.assertMechanic(dto.mechanicId);
    }

    const updated = await this.prisma.client.maintenanceLog.update({
      where: { id },
      data: {
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.cost !== undefined ? { cost: dto.cost } : {}),
        ...(dto.performedAt !== undefined ? { performedAt: toDate(dto.performedAt) } : {}),
        ...(dto.mechanicId !== undefined ? { mechanicId: dto.mechanicId } : {}),
        ...(dto.mileageAtService !== undefined ? { mileageAtService: dto.mileageAtService } : {}),
        ...(dto.nextServiceDate !== undefined
          ? { nextServiceDate: dto.nextServiceDate ? toDate(dto.nextServiceDate) : null }
          : {}),
        ...(dto.nextServiceMileage !== undefined
          ? { nextServiceMileage: dto.nextServiceMileage }
          : {}),
      },
    });

    if (dto.mileageAtService != null) {
      const motorcycle = await this.getMotorcycle(existing.motorcycleId);
      if (dto.mileageAtService > motorcycle.currentMileage) {
        await this.prisma.client.motorcycle.update({
          where: { id: motorcycle.id },
          data: { currentMileage: dto.mileageAtService },
        });
      }
    }

    return updated;
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    assertOwnerOrManager(actor);
    await this.get(id, actor);
    // Cascade removes any reminder rows tied to this log.
    await this.prisma.client.maintenanceLog.delete({ where: { id } });
  }
}
