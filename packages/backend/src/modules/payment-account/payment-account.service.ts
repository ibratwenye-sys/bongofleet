import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentAccountKind, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreatePaymentAccountDto } from './dto/create-payment-account.dto';
import { UpdatePaymentAccountDto } from './dto/update-payment-account.dto';
import { ListPaymentAccountsQueryDto } from './dto/list-payment-accounts-query.dto';

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may manage payment accounts');
  }
}

/**
 * Per-kind field requirements (§Part 2). BANK is the only kind where
 * accountName is mandatory - a driver paying into a till number or a mobile
 * money number has no "account name" to give. Exported so the unit tests
 * exercise the exact rule the service enforces, not a re-description of it.
 */
export function validatePaymentAccountFields(fields: {
  kind: PaymentAccountKind;
  provider?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
}): void {
  if (!fields.provider) {
    throw new BadRequestException('provider is required');
  }
  if (!fields.accountNumber) {
    throw new BadRequestException('accountNumber is required');
  }
  if (fields.kind === PaymentAccountKind.BANK && !fields.accountName) {
    throw new BadRequestException('accountName is required for a BANK payment account');
  }
}

@Injectable()
export class PaymentAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePaymentAccountDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    validatePaymentAccountFields(dto);

    return this.prisma.client.paymentAccount.create({
      data: {
        tenantId: actor.tenantId,
        kind: dto.kind,
        provider: dto.provider,
        accountNumber: dto.accountNumber,
        accountName: dto.accountName,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
    });
  }

  async list(query: ListPaymentAccountsQueryDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    return this.prisma.client.paymentAccount.findMany({
      where: query.activeOnly ? { isActive: true } : {},
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async update(id: string, dto: UpdatePaymentAccountDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const existing = await this.prisma.client.paymentAccount.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Payment account not found');
    }

    validatePaymentAccountFields({
      kind: dto.kind ?? existing.kind,
      provider: dto.provider ?? existing.provider,
      accountNumber: dto.accountNumber ?? existing.accountNumber,
      accountName: dto.accountName ?? existing.accountName,
    });

    return this.prisma.client.paymentAccount.update({
      where: { id },
      data: {
        kind: dto.kind,
        provider: dto.provider,
        accountNumber: dto.accountNumber,
        accountName: dto.accountName,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
    });
  }

  /** Soft-delete (isActive=false) when referenced by any DailyPayment - a
   *  payment must never end up pointing at a vanished account. Hard-delete
   *  only when nothing references it. */
  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    assertOwnerOrManager(actor);

    const existing = await this.prisma.client.paymentAccount.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Payment account not found');
    }

    const referencedCount = await this.prisma.client.dailyPayment.count({
      where: { paymentAccountId: id },
    });

    if (referencedCount > 0) {
      await this.prisma.client.paymentAccount.update({
        where: { id },
        data: { isActive: false },
      });
      return;
    }

    await this.prisma.client.paymentAccount.delete({ where: { id } });
  }
}
