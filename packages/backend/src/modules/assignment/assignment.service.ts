import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { generateRideReference } from '../../common/reference.util';
import { describeMismatch, isCompatible } from '../../common/driver-vehicle-compatibility';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { ListAssignmentsQueryDto } from './dto/list-assignments-query.dto';

@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createAssignment(dto: CreateAssignmentDto, actor: AuthenticatedUser) {
    if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
      throw new ForbiddenException('Only OWNER or MANAGER may create assignments');
    }

    const motorcycle = await this.prisma.client.motorcycle.findUnique({
      where: { id: dto.motorcycleId },
    });
    if (!motorcycle || !motorcycle.isActive) {
      throw new NotFoundException('Motorcycle not found');
    }

    const driver = await this.prisma.client.driver.findUnique({
      where: { id: dto.driverId },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    if (!driver || !driver.isActive) {
      throw new NotFoundException('Driver not found');
    }

    let categoryOverride: {
      categoryOverrideReason: string;
      categoryOverrideByUserId: string;
      categoryOverrideAt: Date;
    } | null = null;

    if (!isCompatible(driver.driverType, motorcycle.vehicleType)) {
      const driverName = `${driver.user.firstName} ${driver.user.lastName}`;
      const authorized = actor.role === UserRole.OWNER && Boolean(dto.categoryOverrideReason);
      if (!authorized) {
        throw new BadRequestException(
          describeMismatch(
            { name: driverName, driverType: driver.driverType },
            {
              registrationNumber: motorcycle.registrationNumber,
              vehicleType: motorcycle.vehicleType,
            },
          ),
        );
      }
      categoryOverride = {
        categoryOverrideReason: dto.categoryOverrideReason as string,
        categoryOverrideByUserId: actor.userId,
        categoryOverrideAt: new Date(),
      };
      this.logger.warn(
        `Category override by ${actor.email} (OWNER): ${driverName} (${driver.driverType}) ` +
          `assigned to ${motorcycle.registrationNumber} (${motorcycle.vehicleType}). ` +
          `Reason: ${categoryOverride.categoryOverrideReason}`,
      );
    }

    const assignedDate = new Date(dto.assignedDate);

    const bikeBooked = await this.prisma.client.dailyAssignment.findFirst({
      where: { motorcycleId: dto.motorcycleId, assignedDate },
    });
    if (bikeBooked) {
      throw new ConflictException('This motorcycle already has an assignment on this date');
    }

    const driverBooked = await this.prisma.client.dailyAssignment.findFirst({
      where: { driverId: dto.driverId, assignedDate },
    });
    if (driverBooked) {
      throw new ConflictException('This driver already has an assignment on this date');
    }

    // Retry only on the (astronomically rare) ride-reference collision; a date
    // conflict on motorcycle/driver is a real ConflictException, not a retry.
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.client.dailyAssignment.create({
          data: {
            tenantId: actor.tenantId,
            motorcycleId: dto.motorcycleId,
            driverId: dto.driverId,
            assignedDate,
            targetAmount: dto.targetAmount,
            notes: dto.notes,
            reference: generateRideReference(),
            ...categoryOverride,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const target = error.meta?.target;
          const referenceCollision = Array.isArray(target)
            ? target.some((t) => String(t).includes('reference'))
            : String(target ?? '').includes('reference');
          if (referenceCollision && attempt < 5) {
            continue;
          }
          throw new ConflictException(
            'This motorcycle or driver already has an assignment on this date',
          );
        }
        throw error;
      }
    }
  }

  async listAssignments(query: ListAssignmentsQueryDto, actor: AuthenticatedUser) {
    const where: Prisma.DailyAssignmentWhereInput = {};

    if (actor.role === UserRole.RIDER) {
      where.driverId = await this.getOwnDriverId(actor);
    } else if (query.driverId) {
      where.driverId = query.driverId;
    }

    if (query.motorcycleId) {
      where.motorcycleId = query.motorcycleId;
    }

    if (query.dateFrom || query.dateTo) {
      where.assignedDate = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    return this.prisma.client.dailyAssignment.findMany({
      where,
      orderBy: { assignedDate: 'desc' },
    });
  }

  async getAssignment(id: string, actor: AuthenticatedUser) {
    const assignment = await this.prisma.client.dailyAssignment.findUnique({
      where: { id },
      include: { motorcycle: true, driver: true, dailyPayments: true },
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (actor.role === UserRole.RIDER) {
      const ownDriverId = await this.getOwnDriverId(actor);
      if (assignment.driverId !== ownDriverId) {
        throw new NotFoundException('Assignment not found');
      }
    }

    return assignment;
  }

  async deleteAssignment(id: string, actor: AuthenticatedUser) {
    if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
      throw new ForbiddenException('Only OWNER or MANAGER may delete assignments');
    }

    const assignment = await this.prisma.client.dailyAssignment.findUnique({
      where: { id },
      include: { dailyPayments: true },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (assignment.dailyPayments.length > 0) {
      throw new BadRequestException(
        'Cannot delete an assignment that has payments recorded against it',
      );
    }

    await this.prisma.client.dailyAssignment.delete({ where: { id } });
  }

  async getAssignmentsByDate(dateParam: string, actor: AuthenticatedUser) {
    const assignedDate = new Date(dateParam);
    if (Number.isNaN(assignedDate.getTime())) {
      throw new BadRequestException('Invalid date');
    }

    const where: Prisma.DailyAssignmentWhereInput = { assignedDate };

    if (actor.role === UserRole.RIDER) {
      where.driverId = await this.getOwnDriverId(actor);
    }

    return this.prisma.client.dailyAssignment.findMany({
      where,
      orderBy: { assignedDate: 'desc' },
    });
  }

  private async getOwnDriverId(actor: AuthenticatedUser): Promise<string> {
    const driver = await this.prisma.client.driver.findUnique({
      where: { userId: actor.userId },
    });
    if (!driver) {
      throw new ForbiddenException('No driver profile is associated with this account');
    }
    return driver.id;
  }
}
