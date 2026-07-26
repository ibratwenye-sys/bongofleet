import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { hashPassword } from '../auth/utils/password.util';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { ListDriversQueryDto } from './dto/list-drivers-query.dto';

const SAFE_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  isActive: true,
} satisfies Prisma.UserSelect;

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may manage drivers');
  }
}

@Injectable()
export class DriverService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateDriverDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const duplicateEmail = await this.prisma.client.user.findFirst({
      where: { email: dto.email },
    });
    if (duplicateEmail) {
      throw new ConflictException('A user with this email already exists');
    }

    const duplicatePhone = await this.prisma.client.user.findFirst({
      where: { phone: dto.phone },
    });
    if (duplicatePhone) {
      throw new ConflictException('A user with this phone number already exists');
    }

    const duplicateLicense = await this.prisma.client.driver.findFirst({
      where: { licenseNumber: dto.licenseNumber },
    });
    if (duplicateLicense) {
      throw new ConflictException('A driver with this license number already exists');
    }

    const passwordHash = await hashPassword(dto.initialPassword);

    try {
      const { driver, user } = await this.prisma.client.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            tenantId: actor.tenantId,
            email: dto.email,
            phone: dto.phone,
            passwordHash,
            role: UserRole.RIDER,
            firstName: dto.firstName,
            lastName: dto.lastName,
            isActive: true,
          },
          select: SAFE_USER_SELECT,
        });

        const driver = await tx.driver.create({
          data: {
            tenantId: actor.tenantId,
            userId: user.id,
            licenseNumber: dto.licenseNumber,
            nationalId: dto.nationalId,
            emergencyContact: dto.emergencyContact,
            driverType: dto.driverType,
          },
        });

        return { driver, user };
      });

      return { ...driver, user };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'A user or driver with this email, phone, or license number already exists',
        );
      }
      throw error;
    }
  }

  async list(query: ListDriversQueryDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const where: Prisma.DriverWhereInput = query.includeInactive ? {} : { isActive: true };

    if (query.search) {
      where.OR = [
        { licenseNumber: { contains: query.search, mode: 'insensitive' } },
        { user: { firstName: { contains: query.search, mode: 'insensitive' } } },
        { user: { lastName: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    return this.prisma.client.driver.findMany({
      where,
      include: { user: { select: SAFE_USER_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const driver = await this.prisma.client.driver.findUnique({
      where: { id },
      include: { user: { select: SAFE_USER_SELECT } },
    });
    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    return driver;
  }

  async update(id: string, dto: UpdateDriverDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const existing = await this.prisma.client.driver.findUnique({
      where: { id },
      include: { user: { select: SAFE_USER_SELECT } },
    });
    if (!existing) {
      throw new NotFoundException('Driver not found');
    }

    if (dto.phone && dto.phone !== existing.user.phone) {
      const duplicate = await this.prisma.client.user.findFirst({ where: { phone: dto.phone } });
      if (duplicate) {
        throw new ConflictException('A user with this phone number already exists');
      }
    }

    if (dto.licenseNumber && dto.licenseNumber !== existing.licenseNumber) {
      const duplicate = await this.prisma.client.driver.findFirst({
        where: { licenseNumber: dto.licenseNumber },
      });
      if (duplicate) {
        throw new ConflictException('A driver with this license number already exists');
      }
    }

    try {
      const { driver, user } = await this.prisma.client.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id: existing.userId },
          data: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
          },
          select: SAFE_USER_SELECT,
        });

        const driver = await tx.driver.update({
          where: { id },
          data: {
            licenseNumber: dto.licenseNumber,
            nationalId: dto.nationalId,
            emergencyContact: dto.emergencyContact,
            driverType: dto.driverType,
          },
        });

        return { driver, user };
      });

      return { ...driver, user };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'A user or driver with this phone number or license number already exists',
        );
      }
      throw error;
    }
  }

  async deactivate(id: string, actor: AuthenticatedUser): Promise<void> {
    assertOwnerOrManager(actor);

    const existing = await this.prisma.client.driver.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Driver not found');
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.driver.update({
        where: { id },
        data: { isActive: false, deletedAt: new Date() },
      });
      await tx.user.update({
        where: { id: existing.userId },
        data: { isActive: false },
      });
    });
  }

  async reactivate(id: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const existing = await this.prisma.client.driver.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Driver not found');
    }

    const { driver, user } = await this.prisma.client.$transaction(async (tx) => {
      const driver = await tx.driver.update({
        where: { id },
        data: { isActive: true, deletedAt: null },
      });
      const user = await tx.user.update({
        where: { id: existing.userId },
        data: { isActive: true },
        select: SAFE_USER_SELECT,
      });
      return { driver, user };
    });

    return { ...driver, user };
  }
}
