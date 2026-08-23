import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExpenseStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';
import { SubmitExpenseDto } from './dto/submit-expense.dto';
import { RejectExpenseDto } from './dto/reject-expense.dto';

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may manage expenses');
  }
}

/** Inclusive [from, to] date filter on a date column, or undefined if neither set. */
export function buildDateRangeFilter(
  from?: string,
  to?: string,
): Prisma.DateTimeFilter | undefined {
  if (!from && !to) {
    return undefined;
  }
  const filter: Prisma.DateTimeFilter = {};
  if (from) {
    filter.gte = new Date(`${from}T00:00:00.000Z`);
  }
  if (to) {
    // `to` is an inclusive calendar day: everything strictly before the next day.
    const next = new Date(`${to}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    filter.lt = next;
  }
  return filter;
}

// Stage H2 - mirrors payment.service.ts's own receipt-upload constants
// exactly (same size cap, same allowed types). Each module keeps its own
// copy rather than importing from another feature module - the established
// convention here, same as getOwnDriverId below.
export const ALLOWED_RECEIPT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);
export const MAX_RECEIPT_SIZE_BYTES = 10 * 1024 * 1024;

export function receiptFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (!ALLOWED_RECEIPT_MIME_TYPES.has(file.mimetype)) {
    callback(new BadRequestException('Only JPEG, PNG, or PDF receipts are allowed'), false);
    return;
  }
  callback(null, true);
}

function sanitizeFileName(originalName: string): string {
  return originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

@Injectable()
export class ExpenseService {
  private readonly uploadsDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.uploadsDir = this.config.get<string>('UPLOADS_DIR', './uploads');
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

  private async assertMotorcycleExists(motorcycleId: string): Promise<void> {
    const found = await this.prisma.client.motorcycle.findUnique({ where: { id: motorcycleId } });
    if (!found) {
      throw new NotFoundException('Motorcycle not found');
    }
  }

  /**
   * Stage H2 (§4's immutability rule) - "once APPROVED, an expense is not
   * editable by anyone." Not PENDING-only: a REJECTED row stays editable/
   * deletable by an OWNER/MANAGER (e.g. to correct a category typo before
   * re-entering it, or to clean it up) - the rule is specifically about
   * APPROVED rows becoming part of the approval trail P&L relies on, not
   * about locking every non-fresh row.
   */
  private assertNotApproved(
    expense: { status: ExpenseStatus },
    action: 'edited' | 'deleted',
  ): void {
    if (expense.status === ExpenseStatus.APPROVED) {
      throw new BadRequestException(`An approved expense cannot be ${action}`);
    }
  }

  async create(dto: CreateExpenseDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    // A job expense also carries the job's vehicle, so per-vehicle transport
    // rollups pick it up (the job's motorcycleId wins over any passed value).
    let motorcycleId = dto.motorcycleId;
    if (dto.transportJobId) {
      const job = await this.prisma.client.transportJob.findUnique({
        where: { id: dto.transportJobId },
      });
      if (!job) {
        throw new NotFoundException('Transport job not found');
      }
      motorcycleId = job.motorcycleId;
    } else if (dto.motorcycleId) {
      await this.assertMotorcycleExists(dto.motorcycleId);
    }

    return this.prisma.client.expense.create({
      data: {
        tenantId: actor.tenantId,
        motorcycleId,
        transportJobId: dto.transportJobId,
        category: dto.category,
        amount: dto.amount,
        incurredAt: new Date(`${dto.incurredAt}T00:00:00.000Z`),
        description: dto.description,
      },
    });
  }

  /**
   * Stage H2 (§4). No motorcycleId/transportJobId in the body - both are
   * derived from the rider's own DailyAssignment on incurredAt, the same
   * driverId+assignedDate lookup assignment.service.ts's getAssignmentsByDate
   * already uses. No assignment that day means there is nothing for this
   * expense to attach to, and the driver is told exactly that rather than
   * silently creating an unattributed row.
   */
  async submit(dto: SubmitExpenseDto, actor: AuthenticatedUser) {
    const ownDriverId = await this.getOwnDriverId(actor);
    const assignedDate = new Date(`${dto.incurredAt}T00:00:00.000Z`);

    const assignment = await this.prisma.client.dailyAssignment.findFirst({
      where: { driverId: ownDriverId, assignedDate },
    });
    if (!assignment) {
      throw new BadRequestException('You had no assignment on that date.');
    }

    return this.prisma.client.expense.create({
      data: {
        tenantId: actor.tenantId,
        motorcycleId: assignment.motorcycleId,
        dailyAssignmentId: assignment.id,
        category: dto.category,
        amount: dto.amount,
        incurredAt: assignedDate,
        description: dto.description,
        status: ExpenseStatus.PENDING,
        submittedByUserId: actor.userId,
        submittedByRiderId: ownDriverId,
      },
    });
  }

  /** Stage H2 - the rider's own submissions only, filtered by
   *  submittedByRiderId (never motorcycleId - that field is also set on
   *  ordinary dashboard-created expenses that are none of this driver's
   *  business). Every status, newest first - a rider needs to see a
   *  rejection just as much as an approval. */
  async listMine(actor: AuthenticatedUser) {
    const ownDriverId = await this.getOwnDriverId(actor);
    return this.prisma.client.expense.findMany({
      where: { submittedByRiderId: ownDriverId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Stage H2 - just the number; no dashboard badge until H3. */
  async pendingCount(actor: AuthenticatedUser): Promise<{ count: number }> {
    assertOwnerOrManager(actor);
    const count = await this.prisma.client.expense.count({
      where: { status: ExpenseStatus.PENDING },
    });
    return { count };
  }

  async list(query: ListExpensesQueryDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const incurredAt = buildDateRangeFilter(query.from, query.to);
    return this.prisma.client.expense.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.motorcycleId ? { motorcycleId: query.motorcycleId } : {}),
        ...(query.vehicleType ? { motorcycle: { vehicleType: query.vehicleType } } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(incurredAt ? { incurredAt } : {}),
      },
      orderBy: { incurredAt: 'desc' },
    });
  }

  async get(id: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    const expense = await this.prisma.client.expense.findUnique({ where: { id } });
    if (!expense) {
      throw new NotFoundException('Expense not found');
    }
    return expense;
  }

  /** Stage H2 - OWNER/MANAGER only, and only from PENDING (checked via
   *  get(), not re-fetched). Approving an already-decided row would
   *  silently re-stamp approvedByUserId/approvedAt, erasing who actually
   *  made the original call. */
  async approve(id: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    const expense = await this.get(id, actor);
    if (expense.status !== ExpenseStatus.PENDING) {
      throw new BadRequestException('Only a pending expense can be approved');
    }
    return this.prisma.client.expense.update({
      where: { id },
      data: {
        status: ExpenseStatus.APPROVED,
        approvedByUserId: actor.userId,
        approvedAt: new Date(),
      },
    });
  }

  /** Stage H2 - same PENDING-only guard as approve(). rejectionReason's
   *  non-empty requirement is enforced by RejectExpenseDto, not re-checked
   *  here. approvedByUserId/approvedAt double as "who/when decided" for
   *  both outcomes - the schema (Stage H1) has no separate rejectedBy*
   *  pair, only rejectionReason as the reject-specific extra field. */
  async reject(id: string, dto: RejectExpenseDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    const expense = await this.get(id, actor);
    if (expense.status !== ExpenseStatus.PENDING) {
      throw new BadRequestException('Only a pending expense can be rejected');
    }
    return this.prisma.client.expense.update({
      where: { id },
      data: {
        status: ExpenseStatus.REJECTED,
        approvedByUserId: actor.userId,
        approvedAt: new Date(),
        rejectionReason: dto.rejectionReason,
      },
    });
  }

  async update(id: string, dto: UpdateExpenseDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    const existing = await this.get(id, actor);
    this.assertNotApproved(existing, 'edited');

    if (dto.motorcycleId) {
      await this.assertMotorcycleExists(dto.motorcycleId);
    }

    return this.prisma.client.expense.update({
      where: { id },
      data: {
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.incurredAt !== undefined
          ? { incurredAt: new Date(`${dto.incurredAt}T00:00:00.000Z`) }
          : {}),
        ...(dto.motorcycleId !== undefined ? { motorcycleId: dto.motorcycleId } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
    });
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    assertOwnerOrManager(actor);
    const existing = await this.get(id, actor);
    this.assertNotApproved(existing, 'deleted');
    await this.prisma.client.expense.delete({ where: { id } });
  }

  /**
   * Stage H2 - mirrors PaymentService.uploadReceipt exactly, but this route
   * is RIDER-only at the controller (not OWNER/MANAGER/RIDER like
   * payment's), so the ownership check is unconditional rather than
   * branching on actor.role. Not-found (not forbidden) for someone else's
   * row - same convention as everywhere else in this codebase - and a
   * separate, clear error once the expense is no longer PENDING.
   */
  async uploadReceipt(id: string, file: Express.Multer.File, actor: AuthenticatedUser) {
    const ownDriverId = await this.getOwnDriverId(actor);
    const expense = await this.prisma.client.expense.findUnique({ where: { id } });
    if (!expense || expense.submittedByRiderId !== ownDriverId) {
      throw new NotFoundException('Expense not found');
    }
    if (expense.status !== ExpenseStatus.PENDING) {
      throw new BadRequestException('A receipt can only be added to a pending expense');
    }

    const fileName = `${randomUUID()}-${sanitizeFileName(file.originalname)}`;
    const storageKey = path.join(actor.tenantId, 'expense-receipts', fileName);
    const absolutePath = path.join(this.uploadsDir, storageKey);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.buffer);

    try {
      const updated = await this.prisma.client.expense.update({
        where: { id },
        data: {
          receiptStorageKey: storageKey,
          receiptFileName: file.originalname,
          receiptMimeType: file.mimetype,
          receiptSizeBytes: file.size,
          receiptUploadedAt: new Date(),
        },
      });
      // Replacing an earlier receipt? drop the now-orphaned file.
      if (expense.receiptStorageKey && expense.receiptStorageKey !== storageKey) {
        await fs
          .unlink(path.join(this.uploadsDir, expense.receiptStorageKey))
          .catch(() => undefined);
      }
      return updated;
    } catch (error) {
      await fs.unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Stage H3 - mirrors PaymentService.getReceiptFile exactly. Unlike
   * uploadReceipt, this route is reachable by all three roles
   * (OWNER/MANAGER/RIDER) - a RIDER sees only their own expense (not-found,
   * not forbidden, on someone else's), an OWNER/MANAGER sees any expense in
   * the tenant. No assertOwnerOrManager call here, same as payment's - the
   * RIDER branch below is the only role-conditional check this method has.
   */
  async getReceiptFile(id: string, actor: AuthenticatedUser) {
    const expense = await this.prisma.client.expense.findUnique({ where: { id } });
    if (!expense) {
      throw new NotFoundException('Expense not found');
    }
    if (actor.role === UserRole.RIDER) {
      const ownDriverId = await this.getOwnDriverId(actor);
      if (expense.submittedByRiderId !== ownDriverId) {
        throw new NotFoundException('Expense not found');
      }
    }
    if (!expense.receiptStorageKey) {
      throw new NotFoundException('No receipt uploaded for this expense');
    }
    const absolutePath = path.join(this.uploadsDir, expense.receiptStorageKey);
    try {
      await fs.access(absolutePath);
    } catch {
      throw new NotFoundException('Receipt file not found');
    }
    return { expense, absolutePath };
  }
}
