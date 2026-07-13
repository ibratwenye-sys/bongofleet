import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateGuarantorDto } from './dto/create-guarantor.dto';
import { UpdateGuarantorDto } from './dto/update-guarantor.dto';

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may manage guarantors');
  }
}

@Injectable()
export class GuarantorService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertRiderExists(riderId: string): Promise<void> {
    const rider = await this.prisma.client.rider.findUnique({ where: { id: riderId } });
    if (!rider) {
      throw new NotFoundException('Rider not found');
    }
  }

  async create(riderId: string, dto: CreateGuarantorDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    await this.assertRiderExists(riderId);

    return this.prisma.client.guarantor.create({
      data: {
        tenantId: actor.tenantId,
        riderId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        relationship: dto.relationship,
        nationalId: dto.nationalId,
      },
    });
  }

  async list(riderId: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    await this.assertRiderExists(riderId);

    return this.prisma.client.guarantor.findMany({
      where: { riderId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, dto: UpdateGuarantorDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const existing = await this.prisma.client.guarantor.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Guarantor not found');
    }

    return this.prisma.client.guarantor.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        relationship: dto.relationship,
        nationalId: dto.nationalId,
      },
    });
  }

  async deactivate(id: string, actor: AuthenticatedUser): Promise<void> {
    assertOwnerOrManager(actor);

    const existing = await this.prisma.client.guarantor.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Guarantor not found');
    }

    await this.prisma.client.guarantor.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });
  }
}
