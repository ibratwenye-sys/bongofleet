import { Prisma, PaymentAccountKind } from '@prisma/client';
import {
  buildContractContent,
  contractTextPairs,
  ordinal,
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
    expect(text).toContain('2,000/=');
    expect(text).toContain('siku tano (5) mfululizo');
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
    expect(firstPrint).toContain('Imechapishwa 5 Machi 2026');
    expect(laterReprint).toContain('Imechapishwa 1 Juni 2026');
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

  it('renders "Haijajazwa / Not on file" for a null contractEndDate in the Swahili term line, not an ISO date', () => {
    const text = allText(fullContext({ plan: { ...fullContext().plan, contractEndDate: null } }));

    expect(text).toContain('na utaisha Haijajazwa / Not on file');
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no ISO dates anywhere
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
    expect(withoutFine).toContain('kutofanya malipo kwa siku tano (5) mfululizo');
  });

  it('renders the source-given fallback as two sentences when the tenant has no payment account configured, and leaves the populated path unchanged', () => {
    const empty = allText(fullContext({ paymentAccounts: [] }));
    const populated = allText(fullContext());

    expect(empty).toContain(
      'Malipo yote yatafanyika kila siku. Hakuna akaunti ya malipo iliyowekwa.',
    );
    expect(empty).toContain('All payments shall be made daily. No payment account configured.');
    expect(populated).toContain(
      'Malipo yote yatafanyika kila siku kupitia nambari ya akaunti ya NMB 0000000000 Acme Fleet Ltd au Lipa namba 000000 (Azam Pesa).',
    );
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
  });

  it('spells the instalment count in Swahili words beside the digits (Stage F3 Part 3)', () => {
    // totalOwed = 1,800,000 - 200,000 = 1,600,000; ceil(1,600,000 / 12,000) = 134.
    const text = allText(fullContext());

    expect(text).toContain('kwa siku mia moja thelathini na nne (134) mfululizo');
  });

  it('formats every shilling amount as Tanzanian "/=" notation with Swahili words beside it', () => {
    const text = allText(fullContext());

    // Declared value (recital): 1,800,000.
    expect(text).toContain('milioni moja na laki nane (1,800,000/=)');
    // Daily amount (clause 1): 12,000.
    expect(text).toContain('elfu kumi na mbili (12,000/=)');
    // Late fee (clause 2): 2,000.
    expect(text).toContain('elfu mbili (2,000/=)');
    // English lines never spell out words - digits and "/=" only.
    expect(text).toContain('Tanzanian shillings 1,800,000/=');
  });

  describe('Part 4 - total repayment sentence', () => {
    it('states the total as dailyAmount x instalmentCount, computed fresh, with its own working shown', () => {
      // dailyAmount 12,000 x instalments 134 = 1,608,000.
      const text = allText(fullContext());

      expect(text).toContain(
        'Jumla ya marejesho yote ni shilingi za kitanzania milioni moja laki sita na elfu nane (1,608,000/=), yaani siku mia moja thelathini na nne (134) kwa shilingi elfu kumi na mbili (12,000/=) kila siku.',
      );
      expect(text).toContain(
        'The total of all remittances is Tanzanian shillings 1,608,000/=, being 134 days at 12,000/= each day.',
      );
    });

    it('drops the sentence entirely when instalmentCount is unavailable, rather than printing a partial or zero total', () => {
      // downPayment === totalPrice => totalOwed = 0 => instalments = 0 (unavailable).
      const ctx = fullContext({
        plan: { ...fullContext().plan, downPayment: new Prisma.Decimal(1_800_000) },
      });
      const text = allText(ctx);

      expect(text).not.toContain('Jumla ya marejesho yote');
      expect(text).not.toContain('The total of all remittances');
    });
  });
});

describe('ordinal (Stage F3 Part 7)', () => {
  it.each<[number, string]>([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [24, '24th'],
    [111, '111th'],
    [112, '112th'],
    [113, '113th'],
    [121, '121st'],
  ])('%i -> %s', (n, expected) => {
    expect(ordinal(n)).toBe(expected);
  });

  it('is applied to the top agreement-date line in English, not the term dates or footer', () => {
    const text = allText(fullContext());

    expect(text).toContain('This agreement was made today, the 1st day of March 2026');
    // The term-dates and footer lines use the short "N Month Year" form, no ordinal.
    expect(text).toContain('shall officially begin on 3 March 2026');
    expect(text).toContain('Printed 1 August 2026');
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
