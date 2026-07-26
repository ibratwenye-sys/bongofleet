import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus, UserRole } from '@prisma/client';
import { PaymentService } from './payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('PaymentService', () => {
  let service: PaymentService;
  let prisma: {
    client: {
      dailyAssignment: { findUnique: jest.Mock };
      driver: { findUnique: jest.Mock };
      dailyPayment: {
        findUnique: jest.Mock;
        findMany: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
      };
    };
  };

  const owner: AuthenticatedUser = {
    userId: 'user-owner',
    tenantId: 'tenant-1',
    role: UserRole.OWNER,
    email: 'owner@example.com',
    firstName: 'O',
    lastName: 'Wner',
    jti: 'jti-owner',
  };

  const driverActor: AuthenticatedUser = {
    userId: 'user-driver',
    tenantId: 'tenant-1',
    role: UserRole.RIDER,
    email: 'driver@example.com',
    firstName: 'D',
    lastName: 'River',
    jti: 'jti-driver',
  };

  const assignment = {
    id: 'assignment-1',
    tenantId: 'tenant-1',
    driverId: 'driver-1',
    motorcycleId: 'moto-1',
    targetAmount: 50000,
    assignedDate: new Date('2026-07-01'),
  };

  const driver = { id: 'driver-1', tenantId: 'tenant-1', userId: 'user-driver' };

  beforeEach(async () => {
    prisma = {
      client: {
        dailyAssignment: { findUnique: jest.fn() },
        driver: { findUnique: jest.fn() },
        dailyPayment: {
          findUnique: jest.fn(),
          findMany: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => './uploads' } },
      ],
    }).compile();

    service = moduleRef.get(PaymentService);
  });

  describe('createPayment', () => {
    const dto = { dailyAssignmentId: 'assignment-1', driverId: 'driver-1', amount: 40000 };

    it('succeeds for a valid owner request', async () => {
      prisma.client.dailyAssignment.findUnique.mockResolvedValue(assignment);
      prisma.client.driver.findUnique.mockResolvedValue(driver);
      prisma.client.dailyPayment.create.mockResolvedValue({ id: 'payment-1', ...dto });

      const result = await service.createPayment(dto, owner);

      expect(prisma.client.dailyPayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: owner.tenantId,
            status: PaymentStatus.PENDING,
          }),
        }),
      );
      expect(result).toEqual({ id: 'payment-1', ...dto });
    });

    it('throws NotFound when the assignment does not exist', async () => {
      prisma.client.dailyAssignment.findUnique.mockResolvedValue(null);

      await expect(service.createPayment(dto, owner)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound when the driver does not exist', async () => {
      prisma.client.dailyAssignment.findUnique.mockResolvedValue(assignment);
      prisma.client.driver.findUnique.mockResolvedValue(null);

      await expect(service.createPayment(dto, owner)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequest when amount exceeds 150% of the target amount', async () => {
      prisma.client.dailyAssignment.findUnique.mockResolvedValue(assignment);
      prisma.client.driver.findUnique.mockResolvedValue(driver);

      await expect(service.createPayment({ ...dto, amount: 76000 }, owner)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("throws Forbidden when a RIDER records a payment for another driver's assignment", async () => {
      // assignment/dto both reference driver-1, but the calling RIDER's own
      // profile (looked up by userId) is a *different* driver (driver-2).
      const someoneElsesDriver = { id: 'driver-1', tenantId: 'tenant-1', userId: 'user-other' };
      const callersOwnDriver = { id: 'driver-2', tenantId: 'tenant-1', userId: 'user-driver' };

      prisma.client.dailyAssignment.findUnique.mockResolvedValue(assignment);
      prisma.client.driver.findUnique.mockImplementation(
        ({ where }: { where: { id?: string; userId?: string } }) => {
          if (where.id) return someoneElsesDriver;
          if (where.userId) return callersOwnDriver;
          return null;
        },
      );

      await expect(service.createPayment(dto, driverActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('listPayments', () => {
    it('returns tenant-scoped results for OWNER, respecting the driverId filter', async () => {
      prisma.client.dailyPayment.findMany.mockResolvedValue([{ id: 'p1' }]);

      await service.listPayments({ driverId: 'driver-9' }, owner);

      expect(prisma.client.dailyPayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ driverId: 'driver-9' }) }),
      );
    });

    it('force-scopes a RIDER to their own payments regardless of query params', async () => {
      prisma.client.driver.findUnique.mockResolvedValue(driver);
      prisma.client.dailyPayment.findMany.mockResolvedValue([{ id: 'p1' }]);

      await service.listPayments({ driverId: 'someone-elses-driver-id' }, driverActor);

      expect(prisma.client.dailyPayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ driverId: driver.id }) }),
      );
    });
  });

  describe('updatePaymentStatus', () => {
    const payment = {
      id: 'payment-1',
      status: PaymentStatus.PENDING,
      paymentMethod: null,
      paidAt: null,
    };

    it('sets paidAt when moving to COMPLETED', async () => {
      prisma.client.dailyPayment.findUnique.mockResolvedValue(payment);
      prisma.client.dailyPayment.update.mockResolvedValue({
        ...payment,
        status: PaymentStatus.COMPLETED,
        paidAt: new Date(),
      });

      await service.updatePaymentStatus('payment-1', { status: PaymentStatus.COMPLETED }, owner);

      expect(prisma.client.dailyPayment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: PaymentStatus.COMPLETED,
            paidAt: expect.any(Date),
          }),
        }),
      );
    });

    it('throws Forbidden when called by a RIDER', async () => {
      await expect(
        service.updatePaymentStatus('payment-1', { status: PaymentStatus.COMPLETED }, driverActor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.client.dailyPayment.findUnique).not.toHaveBeenCalled();
    });
  });
});
