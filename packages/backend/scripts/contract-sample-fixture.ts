/**
 * Shared fixture for the contract review scripts (dump-contract-swahili-
 * strings.ts, generate-contract-samples.ts) - one definition, so the strings
 * file and the sample PDFs Ibrahim reviews are always generated from the
 * exact same plan rather than two hand-maintained copies that can drift.
 *
 * Not a real driver/tenant/vehicle. FULL_SAMPLE_CONTEXT has every nullable
 * field populated so the dumped output shows the full set of wording a real
 * contract can contain; SPARSE_SAMPLE_CONTEXT leaves everything optional
 * null - the document a new owner actually generates on day one, and the
 * one most likely to look broken.
 */
import { Prisma, PaymentAccountKind } from '@prisma/client';
import { ContractContext } from '../src/modules/ownership-plan/ownership-plan-contract.pdf';

export const FULL_SAMPLE_CONTEXT: ContractContext = {
  renderedAt: new Date('2026-08-01T00:00:00.000Z'),
  tenant: {
    name: 'Mfano Fleet Ltd',
    physicalAddress: 'Barabara ya Mandela, Kariakoo, Dar es Salaam',
    directorName: 'Amina Said',
  },
  driver: {
    fullName: 'Juma Hassan Mwakalinga',
    nationalId: '00000000-00000-00000-00',
    residenceWard: 'Kariakoo',
    residenceDistrict: 'Ilala',
    residenceRegion: 'Dar es Salaam',
  },
  vehicle: {
    registrationNumber: 'T 456 DEF',
    chassisNumber: 'MH1JF5011KK098765',
    make: 'TVS',
    model: 'HLX 125',
    colour: 'Nyekundu',
  },
  plan: {
    agreementDate: new Date('2026-03-03T00:00:00.000Z'),
    totalPrice: new Prisma.Decimal(1_800_000),
    downPayment: new Prisma.Decimal(200_000),
    dailyAmount: new Prisma.Decimal(12_000),
    startDate: new Date('2026-03-03T00:00:00.000Z'),
    contractEndDate: new Date('2027-03-03T00:00:00.000Z'),
    lateFeeAmount: new Prisma.Decimal(2_000),
    breachAfterConsecutiveMissedDays: 5,
  },
  guarantor: {
    fullName: 'Zainabu Hassan Mwakalinga',
    phone: '+255700000000',
    residenceWard: 'Kariakoo',
    residenceDistrict: 'Ilala',
    residenceRegion: 'Dar es Salaam',
  },
  paymentAccounts: [
    {
      kind: PaymentAccountKind.BANK,
      provider: 'NMB',
      accountNumber: '0000000000',
      accountName: 'Mfano Fleet Ltd',
    },
    {
      kind: PaymentAccountKind.LIPA_NUMBER,
      provider: 'Azam Pesa',
      accountNumber: '000000',
      accountName: null,
    },
    {
      kind: PaymentAccountKind.MOBILE_MONEY,
      provider: 'M-Pesa',
      accountNumber: '+255700000001',
      accountName: null,
    },
  ],
};

export const SPARSE_SAMPLE_CONTEXT: ContractContext = {
  renderedAt: new Date('2026-08-01T00:00:00.000Z'),
  tenant: {
    name: 'Mfano Fleet Ltd',
    physicalAddress: null,
    directorName: null,
  },
  driver: {
    fullName: 'Juma Hassan Mwakalinga',
    nationalId: null,
    residenceWard: null,
    residenceDistrict: null,
    residenceRegion: null,
  },
  vehicle: {
    registrationNumber: 'T 456 DEF',
    chassisNumber: null,
    make: null,
    model: null,
    colour: null,
  },
  plan: {
    agreementDate: new Date('2026-08-01T00:00:00.000Z'),
    totalPrice: new Prisma.Decimal(1_800_000),
    downPayment: new Prisma.Decimal(0),
    dailyAmount: new Prisma.Decimal(12_000),
    startDate: new Date('2026-08-03T00:00:00.000Z'),
    contractEndDate: null,
    lateFeeAmount: null,
    breachAfterConsecutiveMissedDays: 5,
  },
  guarantor: null,
  paymentAccounts: [],
};
