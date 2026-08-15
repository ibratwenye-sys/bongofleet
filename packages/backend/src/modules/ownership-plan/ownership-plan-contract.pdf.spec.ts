import { Prisma, PaymentAccountKind } from '@prisma/client';
import {
  buildContractContent,
  contractTextPairs,
  ordinal,
  renderContractPdf,
  ContractContext,
  PairPageSpan,
} from './ownership-plan-contract.pdf';
import {
  FULL_SAMPLE_CONTEXT,
  SPARSE_SAMPLE_CONTEXT,
  LARGE_SAMPLE_CONTEXT,
} from '../../../scripts/contract-sample-fixture';

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
      instalmentCount: 150, // totalOwed = 12,000 x 150 = 1,800,000
      startDate: new Date('2026-03-03T00:00:00.000Z'),
      contractEndDate: new Date('2027-03-03T00:00:00.000Z'),
      lateFeeAmount: new Prisma.Decimal(1_000),
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
    expect(text).toContain('1,000/=');
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
        instalmentCount: 150,
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
    expect(withoutFine).toContain('2. Marejesho ya kila siku ni LAZIMA.');
    expect(withoutFine).toContain('ndani ya siku 5 mfululizo');
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

  it('renders day counts as plain digits, not Swahili words (Stage G7 Part 3b)', () => {
    const text = allText(fullContext());

    expect(text).toContain('kwa siku 150 mfululizo');
    expect(text).not.toContain('siku mia');
  });

  it('formats every shilling amount as Tanzanian "/=" notation with Swahili words beside it', () => {
    const text = allText(fullContext());

    // Declared value (recital): 1,800,000.
    expect(text).toContain('milioni moja na laki nane (1,800,000/=)');
    // Late fee (clause 2): 1,000.
    expect(text).toContain('elfu moja (1,000/=)');
    // English lines never spell out words - digits and "/=" only.
    expect(text).toContain('Tanzanian shillings 1,800,000/=');
  });

  it('drops "/=" only where "TZS" already marks the currency (Clause 1\'s daily amount), keeping it everywhere else (Stage F3a Part 5b)', () => {
    const text = allText(fullContext());

    expect(text).toContain('shilingi elfu kumi na mbili (12,000) TZS kila siku');
    expect(text).toContain('proceeds of shillings 12,000 TZS every day');
    expect(text).not.toContain('12,000/= TZS');
    // Every other amount in the document keeps "/=" - the late fee, for instance.
    expect(text).toContain('elfu moja (1,000/=)');
    expect(text).toContain('shillings 1,000/=');
  });

  describe('Part 4 / Stage G7 Part 3a - total repayment sentence', () => {
    it('states the total as dailyAmount x instalmentCount only - no breakdown, no final-day clause, because a final partial day can no longer exist', () => {
      // totalOwed = 12,000 x 150 = 1,800,000, exactly.
      const text = allText(fullContext());

      expect(text).toContain(
        'Jumla ya marejesho yote ni shilingi za kitanzania milioni moja na laki nane (1,800,000/=).',
      );
      expect(text).toContain('The total of all remittances is Tanzanian shillings 1,800,000/=.');
      expect(text).not.toContain('yaani siku');
      expect(text).not.toContain('siku ya mwisho');
      expect(text).not.toContain('final day');
    });

    it('the total tracks dailyAmount x instalmentCount exactly, decoupled from totalPrice/downPayment', () => {
      // 12,000 x 130 = 1,560,000 - unrelated to this fixture's totalPrice
      // (1,800,000) or downPayment (200,000), which stay untouched below.
      const ctx = fullContext({
        plan: { ...fullContext().plan, instalmentCount: 130 },
      });
      const text = allText(ctx);

      expect(text).toContain(
        'Jumla ya marejesho yote ni shilingi za kitanzania milioni moja laki tano na elfu sitini (1,560,000/=).',
      );
      expect(text).toContain('The total of all remittances is Tanzanian shillings 1,560,000/=.');
      expect(text).toContain('kwa siku 130 mfululizo');
    });

    it('drops the sentence entirely when instalmentCount is 0, rather than printing a zero total', () => {
      const ctx = fullContext({
        plan: { ...fullContext().plan, instalmentCount: 0 },
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

  describe('every bilingual pair renders on a single page (Stage F3d Part 2/3)', () => {
    // A sample was once observed to split
    // "Sahihi: ______________    Mahali anapoishi: ..." from its own English
    // translation across the page 1/2 boundary - the same defect could hit
    // any pair, not just ones inside a group() block. Checked via the
    // PairPageSpan the renderer reports for each pair as it draws it (Stage
    // F3d Part 3), not by parsing the finished PDF's text back out.
    it.each<[string, ContractContext]>([
      ['FULL', FULL_SAMPLE_CONTEXT],
      ['SPARSE', SPARSE_SAMPLE_CONTEXT],
      ['LARGE', LARGE_SAMPLE_CONTEXT],
    ])('%s sample: no pair starts on one page and ends on another', async (_label, ctx) => {
      const spans: PairPageSpan[] = [];
      await renderContractPdf(ctx, (span) => spans.push(span));

      const pairCount = contractTextPairs(ctx).length;
      expect(spans).toHaveLength(pairCount);

      const split = spans.filter((s) => s.startPage !== s.endPage);
      expect(split).toEqual([]);
    });
  });
});
