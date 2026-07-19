import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';

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

@Injectable()
export class ExpenseService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertMotorcycleExists(motorcycleId: string): Promise<void> {
    const found = await this.prisma.client.motorcycle.findUnique({ where: { id: motorcycleId } });
    if (!found) {
      throw new NotFoundException('Motorcycle not found');
    }
  }

  async create(dto: CreateExpenseDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    if (dto.motorcycleId) {
      await this.assertMotorcycleExists(dto.motorcycleId);
    }

    return this.prisma.client.expense.create({
      data: {
        tenantId: actor.tenantId,
        motorcycleId: dto.motorcycleId,
        category: dto.category,
        amount: dto.amount,
        incurredAt: new Date(`${dto.incurredAt}T00:00:00.000Z`),
        description: dto.description,
      },
    });
  }

  async list(query: ListExpensesQueryDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const incurredAt = buildDateRangeFilter(query.from, query.to);
    return this.prisma.client.expense.findMany({
      where: {
        ...(query.motorcycleId ? { motorcycleId: query.motorcycleId } : {}),
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

  async update(id: string, dto: UpdateExpenseDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    await this.get(id, actor);

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
    await this.get(id, actor);
    await this.prisma.client.expense.delete({ where: { id } });
  }
}
