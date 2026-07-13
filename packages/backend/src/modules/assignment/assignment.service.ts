import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { ListAssignmentsQueryDto } from './dto/list-assignments-query.dto';

@Injectable()
export class AssignmentService {
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

    const rider = await this.prisma.client.rider.findUnique({ where: { id: dto.riderId } });
    if (!rider || !rider.isActive) {
      throw new NotFoundException('Rider not found');
    }

    const assignedDate = new Date(dto.assignedDate);

    const bikeBooked = await this.prisma.client.dailyAssignment.findFirst({
      where: { motorcycleId: dto.motorcycleId, assignedDate },
    });
    if (bikeBooked) {
      throw new ConflictException('This motorcycle already has an assignment on this date');
    }

    const riderBooked = await this.prisma.client.dailyAssignment.findFirst({
      where: { riderId: dto.riderId, assignedDate },
    });
    if (riderBooked) {
      throw new ConflictException('This rider already has an assignment on this date');
    }

    try {
      return await this.prisma.client.dailyAssignment.create({
        data: {
          tenantId: actor.tenantId,
          motorcycleId: dto.motorcycleId,
          riderId: dto.riderId,
          assignedDate,
          targetAmount: dto.targetAmount,
          notes: dto.notes,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'This motorcycle or rider already has an assignment on this date',
        );
      }
      throw error;
    }
  }

  async listAssignments(query: ListAssignmentsQueryDto, actor: AuthenticatedUser) {
    const where: Prisma.DailyAssignmentWhereInput = {};

    if (actor.role === UserRole.RIDER) {
      where.riderId = await this.getOwnRiderId(actor);
    } else if (query.riderId) {
      where.riderId = query.riderId;
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
      include: { motorcycle: true, rider: true, dailyPayments: true },
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (actor.role === UserRole.RIDER) {
      const ownRiderId = await this.getOwnRiderId(actor);
      if (assignment.riderId !== ownRiderId) {
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
      where.riderId = await this.getOwnRiderId(actor);
    }

    return this.prisma.client.dailyAssignment.findMany({
      where,
      orderBy: { assignedDate: 'desc' },
    });
  }

  private async getOwnRiderId(actor: AuthenticatedUser): Promise<string> {
    const rider = await this.prisma.client.rider.findUnique({
      where: { userId: actor.userId },
    });
    if (!rider) {
      throw new ForbiddenException('No rider profile is associated with this account');
    }
    return rider.id;
  }
}
