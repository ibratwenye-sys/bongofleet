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

  private async assertDriverExists(driverId: string): Promise<void> {
    const driver = await this.prisma.client.driver.findUnique({ where: { id: driverId } });
    if (!driver) {
      throw new NotFoundException('Driver not found');
    }
  }

  async create(driverId: string, dto: CreateGuarantorDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    await this.assertDriverExists(driverId);

    return this.prisma.client.guarantor.create({
      data: {
        tenantId: actor.tenantId,
        driverId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        relationship: dto.relationship,
        nationalId: dto.nationalId,
        residenceWard: dto.residenceWard,
        residenceDistrict: dto.residenceDistrict,
        residenceRegion: dto.residenceRegion,
      },
    });
  }

  async list(driverId: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    await this.assertDriverExists(driverId);

    return this.prisma.client.guarantor.findMany({
      where: { driverId, isActive: true },
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
        residenceWard: dto.residenceWard,
        residenceDistrict: dto.residenceDistrict,
        residenceRegion: dto.residenceRegion,
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
