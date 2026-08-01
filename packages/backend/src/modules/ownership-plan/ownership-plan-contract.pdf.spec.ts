import { Prisma, PaymentAccountKind } from '@prisma/client';
import {
  buildContractContent,
  contractTextPairs,
  renderContractPdf,
  ContractContext,
} from './ownership-plan-contract.pdf';

function fullContext(overrides: Partial<ContractContext> = {}): ContractContext {
  return {
    renderedAt: new Date('2026-08-01T00:00:00.000Z'),
    tenant: {
      name: 'Acme Fleet Ltd',
      physicalAddress: 'Uhuru Street, Dar es Salaam',
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
      agreementDate: new Date('2026-03-01T00:00:00.000Z'),
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
        accountName: 'Acme Fleet Ltd',
      },
      {
        kind: PaymentAccountKind.LIPA_NUMBER,
        provider: 'Azam Pesa',
        accountNumber: '000000',
        accountName: null,
      },
    ],
    ...overrides,
  };
}

function allText(ctx: ContractContext): string {
  return contractTextPairs(ctx)
    .map(({ sw, en }) => `${sw}\n${en}`)
    .join('\n');
}

describe('buildContractContent / contractTextPairs', () => {
  it("contains the driver's residence, the chassis number, the colour, the fine amount, the breach threshold, and each active payment account's number", () => {
    const text = allText(fullContext());

    expect(text).toContain('Kariakoo');
    expect(text).toContain('Ilala');
    expect(text).toContain('Dar es Salaam');
    expect(text).toContain('MH1JF5011KK012345');
    expect(text).toContain('Nyekundu');
    expect(text).toContain('2000.00');
    expect(text).toContain('siku 5 mfululizo');
    expect(text).toContain('0000000000');
    expect(text).toContain('000000');
  });

  it('keeps the agreement date fixed across a reprint, distinct from the render timestamp', () => {
    // Same plan, "reprinted" a month later - regenerating a contract must
    // never make it read as if the agreement itself was made on the reprint
    // date. Same discipline as the three balances that must never merge.
    const firstPrint = allText(fullContext({ renderedAt: new Date('2026-03-05T00:00:00.000Z') }));
    const laterReprint = allText(fullContext({ renderedAt: new Date('2026-06-01T00:00:00.000Z') }));

    expect(firstPrint).toContain('tarehe 1 mwezi Machi 2026'); // plan.agreementDate, unchanged
    expect(laterReprint).toContain('tarehe 1 mwezi Machi 2026'); // still the same, on reprint
    expect(firstPrint).toContain('Imechapishwa 2026-03-05');
    expect(laterReprint).toContain('Imechapishwa 2026-06-01');
  });

  it('renders "Haijajazwa / Not on file" for null fields, never "undefined", "null", or "NaN"', () => {
    const ctx = fullContext({
      vehicle: {
        registrationNumber: 'T 123 ABC',
        chassisNumber: null,
        make: null,
        model: null,
        colour: null,
      },
      plan: {
        agreementDate: new Date('2026-03-01T00:00:00.000Z'),
        totalPrice: new Prisma.Decimal(1_800_000),
        downPayment: new Prisma.Decimal(200_000),
        dailyAmount: new Prisma.Decimal(12_000),
        startDate: new Date('2026-03-03T00:00:00.000Z'),
        contractEndDate: null,
        lateFeeAmount: null,
        breachAfterConsecutiveMissedDays: 5,
      },
      guarantor: null,
      paymentAccounts: [],
    });

    const text = allText(ctx);

    expect(text).toContain('Haijajazwa / Not on file');
    expect(text).not.toMatch(/undefined/i);
    expect(text).not.toMatch(/\bnull\b/i);
    expect(text).not.toMatch(/\bNaN\b/);
  });

  it('renders "Haijajazwa / Not on file" for the guarantor block when the driver has no guarantor at all, rather than omitting it', () => {
    const text = allText(fullContext({ guarantor: null }));

    // The block still prints its labels, each field falling back individually.
    expect(text).toContain('Jina: Haijajazwa / Not on file');
    expect(text).toContain('Namba ya simu: Haijajazwa / Not on file');
    expect(text).toContain(
      'Mahali anapoishi: Haijajazwa / Not on file, Haijajazwa / Not on file, Haijajazwa / Not on file',
    );
  });

  it('drops the fine fragment when lateFeeAmount is null but keeps the breach sentence in the same clause', () => {
    const withoutFine = allText(
      fullContext({ plan: { ...fullContext().plan, lateFeeAmount: null } }),
    );
    const withFine = allText(fullContext());

    expect(withoutFine).not.toContain('atalazimika kulipa faini');
    expect(withFine).toContain('atalazimika kulipa faini');
    expect(withoutFine).toContain('kutofanya malipo kwa siku 5 mfululizo');
  });

  it('renders the source-given fallback when the tenant has no payment account configured', () => {
    const text = allText(fullContext({ paymentAccounts: [] }));

    expect(text).toContain('Hakuna akaunti ya malipo iliyowekwa');
    expect(text).toContain('No payment account configured');
  });

  it('joins more than one active payment account with "au"/"or"', () => {
    const text = allText(fullContext());

    expect(text).toMatch(/0000000000.*au.*000000|000000.*au.*0000000000/s);
  });

  it("keeps Clause 4's maintenance split as two separate items, not one fused paragraph", () => {
    const items = buildContractContent(fullContext()).filter(
      (item): item is Extract<typeof item, { kind: 'text' }> => item.kind === 'text',
    );
    const clause4Index = items.findIndex((item) => item.sw.startsWith('4. Iwapo bodaboda'));
    expect(clause4Index).toBeGreaterThan(-1);
    expect(items[clause4Index].sw.endsWith('namna yoyote ile.')).toBe(true);
    expect(items[clause4Index + 1].sw).toBe(
      'Iwapo bodaboda itaharibika ama kupotea kwa uzembe wa dereva, dereva atalazimika kuitengeneza ama kuilipa.',
    );
  });

  it("keeps Clause 8's three sub-points indented and separate, with the liability sub-point findable as its own item", () => {
    const items = buildContractContent(fullContext());
    const liability = items.find(
      (item) => item.kind === 'text' && item.sw.startsWith('Makabidhiano yakishafanyika'),
    );
    expect(liability).toBeDefined();
    expect(liability).toMatchObject({ indent: true });
  });

  it('corrects the three known source typos rather than reproducing them', () => {
    const text = allText(fullContext());

    expect(text).toContain('MMILIKI');
    expect(text).not.toMatch(/MMLIKI\b/);
    expect(text).toContain('hayuko hewani ambayo');
    expect(text).not.toContain('hewaniambayo');
    // "Mia nne ishirini na tano" only appears if spelling out numbers in
    // words, which this renderer deliberately does not do (see below) - so
    // neither the typo'd nor corrected form appears at all.
    expect(text).not.toContain('Mianne');
  });

  it('renders the instalment count as digits only, not spelled out in Swahili words', () => {
    // The source spells "425" as "Mia nne ishirini na tano (425)" as well.
    // Generating arbitrary Swahili number words reliably is not attempted
    // here (see the comment in buildContractContent) - digits only, flagged
    // in the Stage F2 report per the source's own explicit fallback.
    // totalOwed = 1,800,000 - 200,000 = 1,600,000; ceil(1,600,000 / 12,000) = 134.
    // Not a generic "no Swahili word contains these letters" check - ordinary
    // vocabulary elsewhere in the document (e.g. "kusimamia") legitimately
    // contains "mia" as a substring, so this checks specifically for the
    // source's own spelled-number pattern: a number word followed by the
    // digit in parentheses, which this renderer never produces.
    const text = allText(fullContext());

    expect(text).toContain('kwa siku 134 mfululizo');
    expect(text).not.toContain('(134)');
  });
});

describe('renderContractPdf', () => {
  it('produces a real PDF of reasonable size for a fully populated plan', async () => {
    const buffer = await renderContractPdf(fullContext());

    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    // Deliberately weak: a few KB floor, not a tight byte count - this exists
    // so an empty or throwing renderer cannot pass a green suite, not to
    // check layout. Ibrahim reviews the actual PDF by eye for that.
    expect(buffer.length).toBeGreaterThan(2000);
  });
});
