import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TransportJobStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { generateRideReference } from '../../common/reference.util';
import { describeMismatch, isCompatible } from '../../common/driver-vehicle-compatibility';
import { CreateTransportJobDto } from './dto/create-transport-job.dto';
import { UpdateTransportJobDto } from './dto/update-transport-job.dto';
import { ListTransportJobsQueryDto } from './dto/list-transport-jobs-query.dto';

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may manage transport jobs');
  }
}

function money(value: Prisma.Decimal | number | string | null | undefined): string {
  return new Prisma.Decimal(value ?? 0).toFixed(2);
}

/** revenue - expenses, computed with Decimal to avoid float drift. */
function netProfit(
  revenue: Prisma.Decimal | number | string,
  expenses: Prisma.Decimal | number | string | null | undefined,
): string {
  return new Prisma.Decimal(revenue).minus(new Prisma.Decimal(expenses ?? 0)).toFixed(2);
}

@Injectable()
export class TransportService {
  private readonly logger = new Logger(TransportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createJob(dto: CreateTransportJobDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const vehicle = await this.prisma.client.motorcycle.findUnique({
      where: { id: dto.motorcycleId },
    });
    if (!vehicle || !vehicle.isActive) {
      throw new NotFoundException('Vehicle not found');
    }

    const ownerDriven = dto.ownerDriven ?? false;
    let driverId: string | null = dto.driverId ?? null;
    let categoryOverride: {
      categoryOverrideReason: string;
      categoryOverrideByUserId: string;
      categoryOverrideAt: Date;
    } | null = null;

    if (ownerDriven) {
      driverId = null; // owner-driven jobs carry no assigned driver
    } else if (driverId) {
      const driver = await this.prisma.client.driver.findUnique({
        where: { id: driverId },
        include: { user: { select: { firstName: true, lastName: true } } },
      });
      if (!driver || !driver.isActive) {
        throw new NotFoundException('Driver not found');
      }

      if (!isCompatible(driver.driverType, vehicle.vehicleType)) {
        const driverName = `${driver.user.firstName} ${driver.user.lastName}`;
        const authorized = actor.role === UserRole.OWNER && Boolean(dto.categoryOverrideReason);
        if (!authorized) {
          throw new BadRequestException(
            describeMismatch(
              { name: driverName, driverType: driver.driverType },
              { registrationNumber: vehicle.registrationNumber, vehicleType: vehicle.vehicleType },
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
            `assigned to ${vehicle.registrationNumber} (${vehicle.vehicleType}). ` +
            `Reason: ${categoryOverride.categoryOverrideReason}`,
        );
      }
    }

    // Retry only on the astronomically rare reference collision.
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.client.transportJob.create({
          data: {
            tenantId: actor.tenantId,
            motorcycleId: dto.motorcycleId,
            driverId,
            ownerDriven,
            reference: generateRideReference(),
            origin: dto.origin,
            destination: dto.destination,
            cargo: dto.cargo,
            revenue: dto.revenue,
            scheduledDate: new Date(dto.scheduledDate),
            ...categoryOverride,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          attempt < 5
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  async listJobs(query: ListTransportJobsQueryDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const where: Prisma.TransportJobWhereInput = {};
    if (query.motorcycleId) {
      where.motorcycleId = query.motorcycleId;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.dateFrom || query.dateTo) {
      where.scheduledDate = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    const jobs = await this.prisma.client.transportJob.findMany({
      where,
      orderBy: { scheduledDate: 'desc' },
      include: { motorcycle: true, driver: { include: { user: true } } },
    });

    const expenseByJob = await this.sumExpensesByJob(jobs.map((j) => j.id));

    return jobs.map((job) => this.withPnl(job, expenseByJob.get(job.id)));
  }

  async getJob(id: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const job = await this.prisma.client.transportJob.findUnique({
      where: { id },
      include: {
        motorcycle: true,
        driver: { include: { user: true } },
        expenses: { orderBy: { incurredAt: 'desc' } },
      },
    });
    if (!job) {
      throw new NotFoundException('Transport job not found');
    }

    const expenseTotal = job.expenses.reduce(
      (sum, e) => sum.plus(new Prisma.Decimal(e.amount)),
      new Prisma.Decimal(0),
    );

    return this.withPnl(job, expenseTotal);
  }

  async updateJob(id: string, dto: UpdateTransportJobDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const existing = await this.prisma.client.transportJob.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Transport job not found');
    }

    const data: Prisma.TransportJobUpdateInput = {};

    if (dto.ownerDriven !== undefined) {
      data.ownerDriven = dto.ownerDriven;
      if (dto.ownerDriven) {
        data.driver = { disconnect: true };
      }
    }
    if (dto.driverId !== undefined && !(dto.ownerDriven ?? existing.ownerDriven)) {
      const driver = await this.prisma.client.driver.findUnique({
        where: { id: dto.driverId },
        include: { user: { select: { firstName: true, lastName: true } } },
      });
      if (!driver || !driver.isActive) {
        throw new NotFoundException('Driver not found');
      }

      // The vehicle itself is not changeable via this endpoint, but the check
      // is written against the RESULTING pairing (not just "did driverId
      // change") so it stays correct if that ever changes.
      const vehicle = await this.prisma.client.motorcycle.findUnique({
        where: { id: existing.motorcycleId },
      });
      if (!vehicle) {
        throw new NotFoundException('Vehicle not found');
      }

      if (!isCompatible(driver.driverType, vehicle.vehicleType)) {
        const driverName = `${driver.user.firstName} ${driver.user.lastName}`;
        const authorized = actor.role === UserRole.OWNER && Boolean(dto.categoryOverrideReason);
        if (!authorized) {
          throw new BadRequestException(
            describeMismatch(
              { name: driverName, driverType: driver.driverType },
              { registrationNumber: vehicle.registrationNumber, vehicleType: vehicle.vehicleType },
            ),
          );
        }
        data.categoryOverrideReason = dto.categoryOverrideReason as string;
        data.categoryOverrideByUserId = actor.userId;
        data.categoryOverrideAt = new Date();
        this.logger.warn(
          `Category override by ${actor.email} (OWNER): ${driverName} (${driver.driverType}) ` +
            `assigned to ${vehicle.registrationNumber} (${vehicle.vehicleType}) via update. ` +
            `Reason: ${data.categoryOverrideReason}`,
        );
      }

      data.driver = { connect: { id: dto.driverId } };
    }
    if (dto.origin !== undefined) data.origin = dto.origin;
    if (dto.destination !== undefined) data.destination = dto.destination;
    if (dto.cargo !== undefined) data.cargo = dto.cargo;
    if (dto.revenue !== undefined) data.revenue = dto.revenue;
    if (dto.scheduledDate !== undefined) data.scheduledDate = new Date(dto.scheduledDate);

    if (dto.status !== undefined && dto.status !== existing.status) {
      data.status = dto.status;
      // Stamp the milestone timestamps when first reached.
      if (dto.status === TransportJobStatus.IN_TRANSIT && !existing.pickedUpAt) {
        data.pickedUpAt = new Date();
      }
      if (dto.status === TransportJobStatus.DELIVERED && !existing.deliveredAt) {
        data.deliveredAt = new Date();
      }
    }

    return this.prisma.client.transportJob.update({ where: { id }, data });
  }

  async deleteJob(id: string, actor: AuthenticatedUser): Promise<void> {
    assertOwnerOrManager(actor);

    const job = await this.prisma.client.transportJob.findUnique({
      where: { id },
      include: { expenses: true },
    });
    if (!job) {
      throw new NotFoundException('Transport job not found');
    }
    if (job.expenses.length > 0) {
      throw new BadRequestException(
        'Cannot delete a transport job that has expenses recorded against it',
      );
    }

    await this.prisma.client.transportJob.delete({ where: { id } });
  }

  /**
   * Per-vehicle transport cost-benefit: total job revenue minus expenses tagged
   * to those jobs, so the owner can see which cars/trucks earn and which lose.
   */
  async vehicleSummary(query: ListTransportJobsQueryDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const where: Prisma.TransportJobWhereInput = {};
    if (query.dateFrom || query.dateTo) {
      where.scheduledDate = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    const jobs = await this.prisma.client.transportJob.findMany({
      where,
      select: { id: true, motorcycleId: true, revenue: true },
    });
    if (jobs.length === 0) {
      return [];
    }

    const expenseByJob = await this.sumExpensesByJob(jobs.map((j) => j.id));

    const perVehicle = new Map<
      string,
      { revenue: Prisma.Decimal; expenses: Prisma.Decimal; jobCount: number }
    >();
    for (const job of jobs) {
      const acc = perVehicle.get(job.motorcycleId) ?? {
        revenue: new Prisma.Decimal(0),
        expenses: new Prisma.Decimal(0),
        jobCount: 0,
      };
      acc.revenue = acc.revenue.plus(new Prisma.Decimal(job.revenue));
      acc.expenses = acc.expenses.plus(expenseByJob.get(job.id) ?? new Prisma.Decimal(0));
      acc.jobCount += 1;
      perVehicle.set(job.motorcycleId, acc);
    }

    const vehicles = await this.prisma.client.motorcycle.findMany({
      where: { id: { in: [...perVehicle.keys()] } },
      select: { id: true, registrationNumber: true, vehicleType: true },
    });
    const vehicleInfo = new Map(vehicles.map((v) => [v.id, v]));

    return [...perVehicle.entries()]
      .map(([motorcycleId, acc]) => ({
        motorcycleId,
        registrationNumber: vehicleInfo.get(motorcycleId)?.registrationNumber ?? 'Unknown',
        vehicleType: vehicleInfo.get(motorcycleId)?.vehicleType ?? null,
        jobCount: acc.jobCount,
        revenue: acc.revenue.toFixed(2),
        expenses: acc.expenses.toFixed(2),
        netProfit: acc.revenue.minus(acc.expenses).toFixed(2),
      }))
      .sort((a, b) => Number(a.netProfit) - Number(b.netProfit)); // losses first
  }

  private async sumExpensesByJob(jobIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    const map = new Map<string, Prisma.Decimal>();
    if (jobIds.length === 0) {
      return map;
    }
    const grouped = await this.prisma.client.expense.groupBy({
      by: ['transportJobId'],
      where: { transportJobId: { in: jobIds } },
      _sum: { amount: true },
    });
    for (const row of grouped) {
      if (row.transportJobId) {
        map.set(row.transportJobId, new Prisma.Decimal(row._sum.amount ?? 0));
      }
    }
    return map;
  }

  private withPnl<T extends { revenue: Prisma.Decimal }>(
    job: T,
    expenses: Prisma.Decimal | undefined,
  ) {
    const expenseTotal = expenses ?? new Prisma.Decimal(0);
    return {
      ...job,
      expensesTotal: money(expenseTotal),
      netProfit: netProfit(job.revenue, expenseTotal),
    };
  }
}
