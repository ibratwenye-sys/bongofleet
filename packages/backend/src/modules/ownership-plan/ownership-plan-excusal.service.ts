import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DayExcusalStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateDayExcusalDto } from './dto/create-day-excusal.dto';

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may manage day excusals');
  }
}

/**
 * Stage G4. DayExcusal is the record that lets computeConsecutiveMissedDays
 * (ownership-plan.derivation.ts) tell "phoned in, excused" apart from
 * "vanished" - see that model's own schema comment for the full design.
 *
 * Every method here is OWNER/MANAGER only, same split as the rest of this
 * module: wrong role is a 403 from RolesGuard at the controller; wrong
 * tenant/plan is a 404 from here, indistinguishable from an unknown id.
 */
@Injectable()
export class OwnershipPlanExcusalService {
  constructor(private readonly prisma: PrismaService) {}

  private async findPlanOrThrow(planId: string) {
    // Tenant-scoped by the Prisma extension - a cross-tenant id is already
    // null here, before any explicit check.
    const plan = await this.prisma.client.ownershipPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw new NotFoundException('Ownership plan not found');
    }
    return plan;
  }

  /**
   * Staff-created excusals are approved immediately - there is no review
   * step for something an OWNER/MANAGER typed in themselves; requestedByUserId
   * stays null (see DayExcusal's own comment). The driver-app request path
   * (REQUESTED, requestedByUserId set, decided later by staff) is not built
   * in this stage - this method's shape doesn't need to change for it to
   * exist as a sibling create path later.
   */
  async create(planId: string, dto: CreateDayExcusalDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    await this.findPlanOrThrow(planId);

    const now = new Date();
    return this.prisma.client.dayExcusal.create({
      data: {
        tenantId: actor.tenantId,
        ownershipPlanId: planId,
        excusedDate: new Date(dto.excusedDate),
        reason: dto.reason,
        status: DayExcusalStatus.APPROVED,
        decidedByUserId: actor.userId,
        decidedAt: now,
      },
    });
  }

  async list(planId: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    await this.findPlanOrThrow(planId);

    return this.prisma.client.dayExcusal.findMany({
      where: { ownershipPlanId: planId },
      orderBy: { excusedDate: 'desc' },
    });
  }

  /**
   * Declines a REQUESTED excusal, or revokes an already-APPROVED one - both
   * are the same transition to DECLINED (Stage G4 Part 3), and either way
   * computeConsecutiveMissedDays stops treating the date as excused the next
   * time figures are derived.
   */
  async decline(planId: string, excusalId: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    await this.findPlanOrThrow(planId);

    const excusal = await this.prisma.client.dayExcusal.findUnique({ where: { id: excusalId } });
    if (!excusal || excusal.ownershipPlanId !== planId) {
      throw new NotFoundException('Day excusal not found');
    }
    if (excusal.status === DayExcusalStatus.DECLINED) {
      throw new BadRequestException('This day excusal has already been declined');
    }

    return this.prisma.client.dayExcusal.update({
      where: { id: excusalId },
      data: {
        status: DayExcusalStatus.DECLINED,
        decidedByUserId: actor.userId,
        decidedAt: new Date(),
      },
    });
  }
}
