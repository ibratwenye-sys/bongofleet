import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentAccountKind, UserRole } from '@prisma/client';
import { PaymentAccountService, validatePaymentAccountFields } from './payment-account.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('validatePaymentAccountFields', () => {
  it('accepts a BANK account with provider, accountNumber, and accountName', () => {
    expect(() =>
      validatePaymentAccountFields({
        kind: PaymentAccountKind.BANK,
        provider: 'NMB',
        accountNumber: '0000000000',
        accountName: 'Acme Fleet Ltd',
      }),
    ).not.toThrow();
  });

  it('rejects a BANK account missing accountName', () => {
    expect(() =>
      validatePaymentAccountFields({
        kind: PaymentAccountKind.BANK,
        provider: 'NMB',
        accountNumber: '0000000000',
        accountName: null,
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts a LIPA_NUMBER account without accountName', () => {
    expect(() =>
      validatePaymentAccountFields({
        kind: PaymentAccountKind.LIPA_NUMBER,
        provider: 'Azam Pesa',
        accountNumber: '000000',
        accountName: null,
      }),
    ).not.toThrow();
  });

  it('rejects a LIPA_NUMBER account missing accountNumber', () => {
    expect(() =>
      validatePaymentAccountFields({
        kind: PaymentAccountKind.LIPA_NUMBER,
        provider: 'Azam Pesa',
        accountNumber: '',
        accountName: null,
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts a MOBILE_MONEY account without accountName', () => {
    expect(() =>
      validatePaymentAccountFields({
        kind: PaymentAccountKind.MOBILE_MONEY,
        provider: 'M-Pesa',
        accountNumber: '+255700000001',
        accountName: null,
      }),
    ).not.toThrow();
  });

  it('rejects a MOBILE_MONEY account missing provider', () => {
    expect(() =>
      validatePaymentAccountFields({
        kind: PaymentAccountKind.MOBILE_MONEY,
        provider: '',
        accountNumber: '+255700000001',
        accountName: null,
      }),
    ).toThrow(BadRequestException);
  });
});

describe('PaymentAccountService', () => {
  let service: PaymentAccountService;
  let prisma: {
    client: {
      paymentAccount: {
        create: jest.Mock;
        findMany: jest.Mock;
        findUnique: jest.Mock;
        update: jest.Mock;
        delete: jest.Mock;
      };
      dailyPayment: { count: jest.Mock };
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
    ...owner,
    role: UserRole.RIDER,
    userId: 'user-driver',
  };

  const existingAccount = {
    id: 'acct-1',
    tenantId: 'tenant-1',
    kind: PaymentAccountKind.BANK,
    provider: 'NMB',
    accountNumber: '0000000000',
    accountName: 'Acme Fleet Ltd',
    isActive: true,
    sortOrder: 0,
  };

  beforeEach(async () => {
    prisma = {
      client: {
        paymentAccount: {
          create: jest.fn(),
          findMany: jest.fn(),
          findUnique: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
        dailyPayment: { count: jest.fn() },
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [PaymentAccountService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(PaymentAccountService);
  });

  describe('create', () => {
    it('throws Forbidden for a RIDER', async () => {
      await expect(
        service.create(
          { kind: PaymentAccountKind.BANK, provider: 'NMB', accountNumber: '1', accountName: 'X' },
          driverActor,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.client.paymentAccount.create).not.toHaveBeenCalled();
    });

    it('rejects an invalid BANK payload before touching Prisma', async () => {
      await expect(
        service.create(
          { kind: PaymentAccountKind.BANK, provider: 'NMB', accountNumber: '1' },
          owner,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.client.paymentAccount.create).not.toHaveBeenCalled();
    });

    it('creates a valid account for an OWNER', async () => {
      prisma.client.paymentAccount.create.mockResolvedValue(existingAccount);

      const result = await service.create(
        {
          kind: PaymentAccountKind.BANK,
          provider: 'NMB',
          accountNumber: '0000000000',
          accountName: 'Acme Fleet Ltd',
        },
        owner,
      );

      expect(prisma.client.paymentAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tenantId: owner.tenantId }) }),
      );
      expect(result).toEqual(existingAccount);
    });
  });

  describe('remove', () => {
    it('throws NotFound for an unknown id', async () => {
      prisma.client.paymentAccount.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing', owner)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft-deletes (isActive=false) when the account has payments against it', async () => {
      prisma.client.paymentAccount.findUnique.mockResolvedValue(existingAccount);
      prisma.client.dailyPayment.count.mockResolvedValue(3);

      await service.remove('acct-1', owner);

      expect(prisma.client.paymentAccount.update).toHaveBeenCalledWith({
        where: { id: 'acct-1' },
        data: { isActive: false },
      });
      expect(prisma.client.paymentAccount.delete).not.toHaveBeenCalled();
    });

    it('hard-deletes when the account has no payments against it', async () => {
      prisma.client.paymentAccount.findUnique.mockResolvedValue(existingAccount);
      prisma.client.dailyPayment.count.mockResolvedValue(0);

      await service.remove('acct-1', owner);

      expect(prisma.client.paymentAccount.delete).toHaveBeenCalledWith({ where: { id: 'acct-1' } });
      expect(prisma.client.paymentAccount.update).not.toHaveBeenCalled();
    });
  });
});
