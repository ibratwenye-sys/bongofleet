import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentStatus, UserRole } from '@prisma/client';
import { PaymentService } from './payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('PaymentService', () => {
  let service: PaymentService;
  let prisma: {
    client: {
      dailyAssignment: { findUnique: jest.Mock };
      rider: { findUnique: jest.Mock };
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

  const riderActor: AuthenticatedUser = {
    userId: 'user-rider',
    tenantId: 'tenant-1',
    role: UserRole.RIDER,
    email: 'rider@example.com',
    firstName: 'R',
    lastName: 'Ider',
    jti: 'jti-rider',
  };

  const assignment = {
    id: 'assignment-1',
    tenantId: 'tenant-1',
    riderId: 'rider-1',
    motorcycleId: 'moto-1',
    targetAmount: 50000,
    assignedDate: new Date('2026-07-01'),
  };

  const rider = { id: 'rider-1', tenantId: 'tenant-1', userId: 'user-rider' };

  beforeEach(async () => {
    prisma = {
      client: {
        dailyAssignment: { findUnique: jest.fn() },
        rider: { findUnique: jest.fn() },
        dailyPayment: {
          findUnique: jest.fn(),
          findMany: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [PaymentService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(PaymentService);
  });

  describe('createPayment', () => {
    const dto = { dailyAssignmentId: 'assignment-1', riderId: 'rider-1', amount: 40000 };

    it('succeeds for a valid owner request', async () => {
      prisma.client.dailyAssignment.findUnique.mockResolvedValue(assignment);
      prisma.client.rider.findUnique.mockResolvedValue(rider);
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

    it('throws NotFound when the rider does not exist', async () => {
      prisma.client.dailyAssignment.findUnique.mockResolvedValue(assignment);
      prisma.client.rider.findUnique.mockResolvedValue(null);

      await expect(service.createPayment(dto, owner)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequest when amount exceeds 150% of the target amount', async () => {
      prisma.client.dailyAssignment.findUnique.mockResolvedValue(assignment);
      prisma.client.rider.findUnique.mockResolvedValue(rider);

      await expect(service.createPayment({ ...dto, amount: 76000 }, owner)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("throws Forbidden when a RIDER records a payment for another rider's assignment", async () => {
      // assignment/dto both reference rider-1, but the calling RIDER's own
      // profile (looked up by userId) is a *different* rider (rider-2).
      const someoneElsesRider = { id: 'rider-1', tenantId: 'tenant-1', userId: 'user-other' };
      const callersOwnRider = { id: 'rider-2', tenantId: 'tenant-1', userId: 'user-rider' };

      prisma.client.dailyAssignment.findUnique.mockResolvedValue(assignment);
      prisma.client.rider.findUnique.mockImplementation(
        ({ where }: { where: { id?: string; userId?: string } }) => {
          if (where.id) return someoneElsesRider;
          if (where.userId) return callersOwnRider;
          return null;
        },
      );

      await expect(service.createPayment(dto, riderActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('listPayments', () => {
    it('returns tenant-scoped results for OWNER, respecting the riderId filter', async () => {
      prisma.client.dailyPayment.findMany.mockResolvedValue([{ id: 'p1' }]);

      await service.listPayments({ riderId: 'rider-9' }, owner);

      expect(prisma.client.dailyPayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ riderId: 'rider-9' }) }),
      );
    });

    it('force-scopes a RIDER to their own payments regardless of query params', async () => {
      prisma.client.rider.findUnique.mockResolvedValue(rider);
      prisma.client.dailyPayment.findMany.mockResolvedValue([{ id: 'p1' }]);

      await service.listPayments({ riderId: 'someone-elses-rider-id' }, riderActor);

      expect(prisma.client.dailyPayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ riderId: rider.id }) }),
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
        service.updatePaymentStatus('payment-1', { status: PaymentStatus.COMPLETED }, riderActor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.client.dailyPayment.findUnique).not.toHaveBeenCalled();
    });
  });
});
