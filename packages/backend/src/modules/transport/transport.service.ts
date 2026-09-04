import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OwnershipPlanStatus, Prisma, TransportJobStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { generateRideReference } from '../../common/reference.util';
import { describeMismatch, isCompatible } from '../../common/driver-vehicle-compatibility';
import { describeOwnershipConflict } from '../../common/ownership-plan-conflict';
import { CreateTransportJobDto } from './dto/create-transport-job.dto';
import { UpdateTransportJobDto } from './dto/update-transport-job.dto';
import { UpdateTransportJobStatusDto } from './dto/update-transport-job-status.dto';
import { ListTransportJobsQueryDto } from './dto/list-transport-jobs-query.dto';
import { computeTransportProgress } from './transport-progress';
import { COUNTED_EXPENSE } from '../analytics/analytics.service';

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may manage transport jobs');
  }
}

// Stage DM15 - a camera photo, not a receipt scan: JPEG/PNG only, no PDF.
// MAX_RECEIPT_SIZE_BYTES is reused from expense.service.ts (not redefined)
// per this stage's own task spec - the one deliberate exception to this
// codebase's usual per-module-copy convention for these upload constants.
export const ALLOWED_DELIVERY_PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png']);

export function deliveryPhotoFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (!ALLOWED_DELIVERY_PHOTO_MIME_TYPES.has(file.mimetype)) {
    callback(new BadRequestException('Only JPEG or PNG delivery photos are allowed'), false);
    return;
  }
  callback(null, true);
}

function sanitizeFileName(originalName: string): string {
  return originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Stage DM4. revenue is the owner's earnings on the job, not the driver's
 * business - and netProfit (= revenue - expensesTotal, see withPnl below)
 * is the SAME secret in a different shape: with expensesTotal still
 * visible, a RIDER could recover the excluded revenue exactly as
 * `netProfit + expensesTotal`. Both are stripped together for that reason,
 * not just revenue alone. expensesTotal and the raw expenses[] stay
 * visible - today they're owner-recorded like everything else here, but
 * they're the job's operational cost record rather than the owner's
 * earnings, and Stage H's driver-submitted-expenses work will make them
 * literally the driver's own data.
 */
function omitOwnerFinancials<T extends { revenue: unknown; netProfit: unknown }>(
  job: T,
): Omit<T, 'revenue' | 'netProfit'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- rest-sibling omission, the whole point is to discard these two
  const { revenue: _revenue, netProfit: _netProfit, ...rest } = job;
  return rest;
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
  private readonly uploadsDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.uploadsDir = this.config.get<string>('UPLOADS_DIR', './uploads');
  }

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

      const driverName = `${driver.user.firstName} ${driver.user.lastName}`;
      await this.assertVehicleNotOnAnotherDriversPlan(
        actor.tenantId,
        dto.motorcycleId,
        driverId,
        driverName,
        vehicle.registrationNumber,
      );

      if (!isCompatible(driver.driverType, vehicle.vehicleType)) {
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
            customerName: dto.customerName,
            customerContactPhone: dto.customerContactPhone,
            revenue: dto.revenue,
            driverFee: dto.driverFee,
            scheduledDate: new Date(dto.scheduledDate),
            expectedDistanceKm: dto.expectedDistanceKm,
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

  /**
   * Stage DM4 - OWNER/MANAGER see every job in the tenant (unchanged); a
   * RIDER sees only their own, narrowed server-side by their own driverId
   * exactly like AssignmentService/PaymentService's listPayments - not
   * left to the client to filter, and not a separate query.
   */
  async listJobs(query: ListTransportJobsQueryDto, actor: AuthenticatedUser) {
    const where: Prisma.TransportJobWhereInput = {};

    if (actor.role === UserRole.RIDER) {
      where.driverId = await this.getOwnDriverId(actor);
    } else {
      assertOwnerOrManager(actor);
      if (query.motorcycleId) {
        where.motorcycleId = query.motorcycleId;
      }
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
      include: {
        motorcycle: true,
        driver: { include: { user: { select: { firstName: true, lastName: true } } } },
      },
    });

    const expenseByJob = await this.sumExpensesByJob(jobs.map((j) => j.id));
    const withFigures = jobs.map((job) => this.withPnl(job, expenseByJob.get(job.id)));

    return actor.role === UserRole.RIDER ? withFigures.map(omitOwnerFinancials) : withFigures;
  }

  /**
   * Stage DM4 - same "404, not 403" convention as everywhere else in this
   * codebase for a RIDER on someone else's resource: an id that is real but
   * not theirs must look identical to an id that doesn't exist.
   */
  async getJob(id: string, actor: AuthenticatedUser) {
    const job = await this.prisma.client.transportJob.findUnique({
      where: { id },
      include: {
        motorcycle: true,
        driver: { include: { user: { select: { firstName: true, lastName: true } } } },
        expenses: { orderBy: { incurredAt: 'desc' } },
      },
    });
    if (!job) {
      throw new NotFoundException('Transport job not found');
    }

    if (actor.role === UserRole.RIDER) {
      const ownDriverId = await this.getOwnDriverId(actor);
      if (job.driverId !== ownDriverId) {
        throw new NotFoundException('Transport job not found');
      }
    } else {
      assertOwnerOrManager(actor);
    }

    const expenseTotal = job.expenses.reduce(
      (sum, e) => sum.plus(new Prisma.Decimal(e.amount)),
      new Prisma.Decimal(0),
    );

    const withFigures = {
      ...this.withPnl(job, expenseTotal),
      fuelSpent: money(await this.fuelSpent(id)),
      progress: await this.jobProgress(job),
    };
    return actor.role === UserRole.RIDER ? omitOwnerFinancials(withFigures) : withFigures;
  }

  /**
   * Stage DM13 - the "Mafuta" stat on the driver app's Today screen. A
   * sibling to sumExpensesByJob below, not a modification of it - that
   * method intentionally sums every category, for P&L, and is used
   * elsewhere; this one is scoped to Fuel only and to a single job. RIDER-
   * safe like fuelSpent below: neither this nor lastSpeedKmh is revenue or
   * netProfit, so omitOwnerFinancials never has to touch them. Single-job
   * only, same N+1-avoidance reasoning as jobProgress - not added to
   * listJobs() or updateOwnStatus().
   */
  private async fuelSpent(jobId: string): Promise<Prisma.Decimal> {
    const result = await this.prisma.client.expense.aggregate({
      where: { transportJobId: jobId, category: 'Fuel', ...COUNTED_EXPENSE },
      _sum: { amount: true },
    });
    return new Prisma.Decimal(result._sum.amount ?? 0);
  }

  /**
   * Stage DM12 - wires transport-progress.ts (Stage UI2, already used by
   * TransportOperationsService.buildInTransitJob for the OWNER-side
   * in-transit card) into the single-job detail response too, for both
   * roles: trip progress is operational, not owner-only. Same query/
   * arithmetic as buildInTransitJob, not reimplemented - pickedUpAt
   * defaults to now for a job that hasn't been picked up yet, same as
   * there, so this never throws for a SCHEDULED job.
   *
   * Stage DM13 - also returns lastSpeedKmh (the "Kasi" stat), read straight
   * off the most recent fix rather than derived - null when there are no
   * fixes, never a guessed speed. Flows into both getJob() and
   * updateOwnStatus() automatically since both already call this.
   * transport-progress.ts itself is untouched (pure, already tested) - the
   * extra field is spread on here instead.
   */
  private async jobProgress(job: {
    motorcycleId: string;
    pickedUpAt: Date | null;
    expectedDistanceKm: Prisma.Decimal | null;
  }) {
    const pickedUpAt = job.pickedUpAt ?? new Date();
    const fixes = await this.prisma.client.gpsLocation.findMany({
      where: { motorcycleId: job.motorcycleId, recordedAt: { gte: pickedUpAt } },
      orderBy: { recordedAt: 'asc' },
      select: { latitude: true, longitude: true, recordedAt: true, speedKmh: true },
    });
    return {
      ...computeTransportProgress(
        fixes,
        job.expectedDistanceKm ? job.expectedDistanceKm.toNumber() : null,
        pickedUpAt,
        new Date(),
      ),
      lastSpeedKmh: fixes[fixes.length - 1]?.speedKmh ?? null,
    };
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

      const driverName = `${driver.user.firstName} ${driver.user.lastName}`;
      await this.assertVehicleNotOnAnotherDriversPlan(
        actor.tenantId,
        existing.motorcycleId,
        dto.driverId,
        driverName,
        vehicle.registrationNumber,
      );

      if (!isCompatible(driver.driverType, vehicle.vehicleType)) {
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
    if (dto.customerName !== undefined) data.customerName = dto.customerName;
    if (dto.customerContactPhone !== undefined) {
      data.customerContactPhone = dto.customerContactPhone;
    }
    if (dto.revenue !== undefined) data.revenue = dto.revenue;
    if (dto.driverFee !== undefined) data.driverFee = dto.driverFee;
    if (dto.scheduledDate !== undefined) data.scheduledDate = new Date(dto.scheduledDate);
    if (dto.expectedDistanceKm !== undefined) data.expectedDistanceKm = dto.expectedDistanceKm;

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

  /**
   * Stage DM12 - a narrow, RIDER-scoped alternative to updateJob() above:
   * a driver may move their own job forward (SCHEDULED -> IN_TRANSIT ->
   * DELIVERED) but must never reassign drivers, edit revenue/driverFee, or
   * rewrite the route - so this touches only status/pickedUpAt/deliveredAt,
   * never the fields updateJob() also accepts. Same "404, not 403"
   * convention as getJob()/listJobs() for a job that isn't the caller's own.
   */
  async updateOwnStatus(id: string, dto: UpdateTransportJobStatusDto, actor: AuthenticatedUser) {
    const ownDriverId = await this.getOwnDriverId(actor);

    const existing = await this.prisma.client.transportJob.findUnique({ where: { id } });
    if (!existing || existing.driverId !== ownDriverId) {
      throw new NotFoundException('Transport job not found');
    }

    const validTransition =
      (existing.status === TransportJobStatus.SCHEDULED &&
        dto.status === TransportJobStatus.IN_TRANSIT) ||
      (existing.status === TransportJobStatus.IN_TRANSIT &&
        dto.status === TransportJobStatus.DELIVERED);
    if (!validTransition) {
      throw new BadRequestException(
        `Cannot move a transport job from ${existing.status} to ${dto.status}`,
      );
    }

    const data: Prisma.TransportJobUpdateInput = { status: dto.status };
    // Same "stamp only if not already set" logic as updateJob() above.
    if (dto.status === TransportJobStatus.IN_TRANSIT && !existing.pickedUpAt) {
      data.pickedUpAt = new Date();
    }
    if (dto.status === TransportJobStatus.DELIVERED && !existing.deliveredAt) {
      data.deliveredAt = new Date();
    }

    const updated = await this.prisma.client.transportJob.update({ where: { id }, data });
    const expenseTotal = (await this.sumExpensesByJob([id])).get(id);
    return omitOwnerFinancials({
      ...this.withPnl(updated, expenseTotal),
      progress: await this.jobProgress(updated),
    });
  }

  /**
   * Stage DM15 - mirrors ExpenseService.uploadReceipt almost verbatim (same
   * UPLOADS_DIR-relative storage, same orphaned-file-unlink-on-replace
   * behavior), with two differences: (1) the job is resolved the same way
   * updateOwnStatus() does - 404 (not 403) when it doesn't exist or isn't
   * the caller's own; (2) upload is only allowed while IN_TRANSIT - a job
   * that hasn't started or is already done has nothing to attach proof to.
   */
  async uploadDeliveryPhoto(id: string, file: Express.Multer.File, actor: AuthenticatedUser) {
    const ownDriverId = await this.getOwnDriverId(actor);
    const existing = await this.prisma.client.transportJob.findUnique({ where: { id } });
    if (!existing || existing.driverId !== ownDriverId) {
      throw new NotFoundException('Transport job not found');
    }
    if (existing.status !== TransportJobStatus.IN_TRANSIT) {
      throw new BadRequestException('A delivery photo can only be added to a job in transit');
    }

    const fileName = `${randomUUID()}-${sanitizeFileName(file.originalname)}`;
    const storageKey = path.join(actor.tenantId, 'delivery-photos', fileName);
    const absolutePath = path.join(this.uploadsDir, storageKey);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.buffer);

    try {
      // Selected, not the raw row: this endpoint is RIDER-only and a plain
      // update() result carries revenue - unlike getJob/listJobs/
      // updateOwnStatus, there's no omitOwnerFinancials() call on this path
      // (it's typed to require netProfit, which nothing here computes), so
      // the fix is to never fetch the owner-only columns back in the first
      // place rather than strip them after the fact.
      const updated = await this.prisma.client.transportJob.update({
        where: { id },
        data: {
          deliveryPhotoStorageKey: storageKey,
          deliveryPhotoFileName: file.originalname,
          deliveryPhotoMimeType: file.mimetype,
          deliveryPhotoSizeBytes: file.size,
          deliveryPhotoUploadedAt: new Date(),
        },
        select: { deliveryPhotoUploadedAt: true },
      });
      // Replacing an earlier photo? drop the now-orphaned file.
      if (existing.deliveryPhotoStorageKey && existing.deliveryPhotoStorageKey !== storageKey) {
        await fs
          .unlink(path.join(this.uploadsDir, existing.deliveryPhotoStorageKey))
          .catch(() => undefined);
      }
      return updated;
    } catch (error) {
      await fs.unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Stage DM15 - mirrors ExpenseService.getReceiptFile: reachable by all
   * three roles, a RIDER sees only their own job (not-found, not forbidden,
   * on someone else's), OWNER/MANAGER see any job. No assertOwnerOrManager
   * call, same as the receipt version - the RIDER branch is the only
   * role-conditional check.
   */
  async getDeliveryPhotoFile(id: string, actor: AuthenticatedUser) {
    const job = await this.prisma.client.transportJob.findUnique({ where: { id } });
    if (!job) {
      throw new NotFoundException('Transport job not found');
    }
    if (actor.role === UserRole.RIDER) {
      const ownDriverId = await this.getOwnDriverId(actor);
      if (job.driverId !== ownDriverId) {
        throw new NotFoundException('Transport job not found');
      }
    }
    if (!job.deliveryPhotoStorageKey) {
      throw new NotFoundException('No delivery photo uploaded for this job');
    }
    const absolutePath = path.join(this.uploadsDir, job.deliveryPhotoStorageKey);
    try {
      await fs.access(absolutePath);
    } catch {
      throw new NotFoundException('Delivery photo file not found');
    }
    return { job, absolutePath };
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

  private async getOwnDriverId(actor: AuthenticatedUser): Promise<string> {
    const driver = await this.prisma.client.driver.findUnique({
      where: { userId: actor.userId },
    });
    if (!driver) {
      throw new ForbiddenException('No driver profile is associated with this account');
    }
    return driver.id;
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

  /**
   * A vehicle part-way through an ownership plan is someone else's property
   * interest, not a competence judgement call like a category mismatch - so
   * this is hard, with no OWNER override. Moving the vehicle requires
   * cancelling or defaulting the plan first, which is a deliberate act with
   * a record.
   */
  private async assertVehicleNotOnAnotherDriversPlan(
    tenantId: string,
    motorcycleId: string,
    driverId: string,
    driverName: string,
    registrationNumber: string,
  ): Promise<void> {
    const activePlan = await this.prisma.client.ownershipPlan.findFirst({
      where: { tenantId, motorcycleId, status: OwnershipPlanStatus.ACTIVE },
    });
    if (!activePlan || activePlan.driverId === driverId) {
      return;
    }

    const planDriver = await this.prisma.client.driver.findUnique({
      where: { id: activePlan.driverId },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    const planDriverName = planDriver
      ? `${planDriver.user.firstName} ${planDriver.user.lastName}`
      : 'another driver';

    throw new ConflictException(
      describeOwnershipConflict({ registrationNumber }, planDriverName, driverName),
    );
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
