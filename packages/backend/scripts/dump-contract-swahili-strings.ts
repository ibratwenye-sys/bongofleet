/**
 * Regenerates CONTRACT_SWAHILI_STRINGS.txt at the repo root from the same
 * buildContractContent() the real PDF renderer uses (see
 * ownership-plan-contract.pdf.ts) - never hand-copy these strings elsewhere,
 * or the proofread file drifts from the actual contract the first time a
 * clause changes.
 *
 * Run: pnpm --filter backend run contract:dump-swahili
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Prisma, PaymentAccountKind } from '@prisma/client';
import {
  contractTextPairs,
  ContractContext,
} from '../src/modules/ownership-plan/ownership-plan-contract.pdf';

// A representative sample plan - not a real driver/tenant/vehicle. Every
// nullable field is populated here so the dumped file shows the full set of
// wording a real contract can contain, not just the null-fallback text.
const SAMPLE_CONTEXT: ContractContext = {
  renderedAt: new Date('2026-08-01T00:00:00.000Z'),
  tenant: {
    name: 'Mfano Fleet Ltd',
    physicalAddress: 'Barabara ya Mandela, Kariakoo, Dar es Salaam',
    directorName: 'Amina Said',
  },
  driver: {
    fullName: 'Juma Hassan',
    nationalId: '00000000-00000-00000-00',
    residenceWard: 'Kariakoo',
    residenceDistrict: 'Ilala',
    residenceRegion: 'Dar es Salaam',
  },
  vehicle: {
    registrationNumber: 'T 123 ABC',
    chassisNumber: 'MH1JF5011KK012345',
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
    fullName: 'Zainabu Hassan',
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

async function main(): Promise<void> {
  const pairs = contractTextPairs(SAMPLE_CONTEXT);
  const lines = pairs.map(({ sw, en }) => `${sw}\t${en}`);
  const outPath = path.join(__dirname, '../../../CONTRACT_SWAHILI_STRINGS.txt');
  await fs.writeFile(outPath, lines.join('\n') + '\n', 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${pairs.length} lines to ${outPath}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
