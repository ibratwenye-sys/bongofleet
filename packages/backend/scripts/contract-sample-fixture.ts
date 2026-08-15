/**
 * Shared fixture for the contract review scripts (dump-contract-swahili-
 * strings.ts, generate-contract-samples.ts) - one definition, so the strings
 * file and the sample PDFs Ibrahim reviews are always generated from the
 * exact same plans rather than hand-maintained copies that can drift.
 *
 * Not a real driver/tenant/vehicle. FULL_SAMPLE_CONTEXT has every nullable
 * field populated so the dumped output shows the full set of wording a real
 * contract can contain; SPARSE_SAMPLE_CONTEXT leaves everything optional
 * null - the document a new owner actually generates on day one, and the
 * one most likely to look broken.
 *
 * Stage G7 retired REMAINDER_SAMPLE_CONTEXT: totalOwed is now
 * dailyAmount * instalmentCount, always exact, so there is no remainder left
 * to demonstrate. LARGE_SAMPLE_CONTEXT replaces it, using Ibrahim's own
 * worked example (12,000/day x 430 days = 5,160,000) - a term long enough to
 * exercise a three-digit-plus day count printed as plain digits, not Swahili
 * words (Stage G7 Part 3b).
 *
 * FULL_SAMPLE_CONTEXT deliberately gives totalPrice/downPayment a declared
 * value (1,800,000 less a 200,000 deposit = 1,600,000) that does NOT equal
 * dailyAmount x instalmentCount (12,000 x 100 = 1,200,000) - the two are
 * independent figures now (Stage G7), and this sample makes that visible on
 * the rendered page rather than leaving it to coincide by accident.
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
    instalmentCount: 100,
    startDate: new Date('2026-03-03T00:00:00.000Z'),
    contractEndDate: new Date('2027-03-03T00:00:00.000Z'),
    lateFeeAmount: new Prisma.Decimal(1_000),
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
    instalmentCount: 150,
    startDate: new Date('2026-08-03T00:00:00.000Z'),
    contractEndDate: null,
    lateFeeAmount: null,
    breachAfterConsecutiveMissedDays: 5,
  },
  guarantor: null,
  paymentAccounts: [],
};

export const LARGE_SAMPLE_CONTEXT: ContractContext = {
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
    // Ibrahim's own worked example: 12,000/day x 430 days = 5,160,000,
    // exactly - dailyAmount x instalmentCount, nothing else.
    totalPrice: new Prisma.Decimal(5_160_000),
    downPayment: new Prisma.Decimal(0),
    dailyAmount: new Prisma.Decimal(12_000),
    instalmentCount: 430,
    startDate: new Date('2026-03-03T00:00:00.000Z'),
    contractEndDate: new Date('2027-05-06T00:00:00.000Z'),
    lateFeeAmount: new Prisma.Decimal(1_000),
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
  ],
};
