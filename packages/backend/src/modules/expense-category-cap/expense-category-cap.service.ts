import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { RIDER_EXPENSE_CATEGORIES } from './rider-expense-categories';
import { UpsertExpenseCategoryCapsDto } from './dto/upsert-expense-category-caps.dto';

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may view expense category caps');
  }
}

function assertOwner(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER) {
    throw new ForbiddenException('Only OWNER may change expense category caps');
  }
}

export interface ExpenseCategoryCapView {
  category: string;
  dailyCapAmount: string | null;
}

@Injectable()
export class ExpenseCategoryCapService {
  constructor(private readonly prisma: PrismaService) {}

  /** Always all 7 rider categories, in the fixed order, never a partial
   *  list - the caller shouldn't have to know which ones have a row in
   *  the DB. */
  async list(actor: AuthenticatedUser): Promise<ExpenseCategoryCapView[]> {
    assertOwnerOrManager(actor);

    const rows = await this.prisma.client.expenseCategoryCap.findMany({
      where: { category: { in: [...RIDER_EXPENSE_CATEGORIES] } },
    });
    const byCategory = new Map(rows.map((r) => [r.category, r.dailyCapAmount]));

    return RIDER_EXPENSE_CATEGORIES.map((category) => ({
      category,
      dailyCapAmount: byCategory.get(category)?.toFixed(2) ?? null,
    }));
  }

  /**
   * A full replace of only the categories included in dto.caps - a
   * category simply left out is left untouched. dailyCapAmount: null
   * deletes that category's row (clears the cap); a number upserts it.
   */
  async upsert(
    dto: UpsertExpenseCategoryCapsDto,
    actor: AuthenticatedUser,
  ): Promise<ExpenseCategoryCapView[]> {
    assertOwner(actor);

    for (const entry of dto.caps) {
      if (entry.dailyCapAmount === null) {
        await this.prisma.client.expenseCategoryCap.deleteMany({
          where: { category: entry.category },
        });
      } else {
        await this.prisma.client.expenseCategoryCap.upsert({
          where: {
            tenantId_category: { tenantId: actor.tenantId, category: entry.category },
          },
          create: {
            tenantId: actor.tenantId,
            category: entry.category,
            dailyCapAmount: entry.dailyCapAmount,
          },
          update: { dailyCapAmount: entry.dailyCapAmount },
        });
      }
    }

    return this.list(actor);
  }
}
