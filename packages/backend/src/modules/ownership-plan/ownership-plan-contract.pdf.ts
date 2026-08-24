// `export = doc` in @types/pdfkit - this import form is required for the
// require() interop to actually resolve to the constructor at runtime; a
// default import would silently break under this tsconfig (no
// esModuleInterop).
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');
import { Prisma, PaymentAccountKind, DepositHandling } from '@prisma/client';
import { formatShillings } from '@bongofleet/shared-lib';
import { toSwahiliWords } from './swahili-numbers';

const NOT_ON_FILE = 'Haijajazwa / Not on file';

const MONTH_LABELS_SW = [
  'Januari',
  'Februari',
  'Machi',
  'Aprili',
  'Mei',
  'Juni',
  'Julai',
  'Agosti',
  'Septemba',
  'Oktoba',
  'Novemba',
  'Desemba',
];
const MONTH_LABELS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export interface ContractContext {
  /** When this PDF was actually generated - printed as a footer line only,
   *  distinct from plan.agreementDate. Regenerating a contract in a later
   *  month must never make it read as if the agreement itself was made
   *  then. */
  renderedAt: Date;
  tenant: {
    name: string;
    physicalAddress: string | null;
    directorName: string | null;
  };
  driver: {
    fullName: string;
    nationalId: string | null;
    residenceWard: string | null;
    residenceDistrict: string | null;
    residenceRegion: string | null;
  };
  vehicle: {
    registrationNumber: string;
    chassisNumber: string | null;
    make: string | null;
    model: string | null;
    colour: string | null;
  };
  plan: {
    /** OwnershipPlan.createdAt - the date the agreement was actually made,
     *  fixed at creation and never affected by a later reprint. */
    agreementDate: Date;
    /** Declared value of the vehicle and the deposit taken (Stage G7) -
     *  printed in the recital below only; never used to derive totalOwed or
     *  anything else arithmetic. May legitimately differ from
     *  dailyAmount * instalmentCount. */
    totalPrice: Prisma.Decimal;
    downPayment: Prisma.Decimal;
    /** Stage G10 (§9e) - gates the deposit recital below: APPLIED prints as
     *  already credited toward the schedule, HELD_REFUNDABLE as returned on
     *  completion. Irrelevant (and unread) when downPayment is 0. */
    depositHandling: DepositHandling;
    dailyAmount: Prisma.Decimal;
    /** The agreed number of payment days - totalOwed = dailyAmount *
     *  instalmentCount, exactly, always. See ownership-plan.derivation.ts. */
    instalmentCount: number;
    startDate: Date;
    contractEndDate: Date | null;
    lateFeeAmount: Prisma.Decimal | null;
    breachAfterConsecutiveMissedDays: number;
  };
  guarantor: {
    fullName: string;
    phone: string;
    residenceWard: string | null;
    residenceDistrict: string | null;
    residenceRegion: string | null;
  } | null;
  paymentAccounts: Array<{
    kind: PaymentAccountKind;
    provider: string;
    accountNumber: string;
    accountName: string | null;
  }>;
}

/**
 * One bilingual line of the rendered contract - Swahili with its English
 * translation beneath, transcribed from Ibrahim's real Cafrika contract (see
 * CONTRACT_SOURCE_SWAHILI.md, Stage F2 Part A). This is the ONLY thing that
 * produces text in the document: renderContractPdf below does nothing but
 * lay these items out with pdfkit, and CONTRACT_SWAHILI_STRINGS.txt and the
 * unit tests both read this exact list rather than a second hand-maintained
 * copy. No clause, heading, label, or signature line may call doc.text()
 * with its own literal string outside this function - if something isn't
 * expressible as an existing item kind, it belongs as a new kind here (see
 * `indent`, added for Clause 8's sub-points, and `group`, added in Stage F3
 * Part 6 for signature/witness blocks that must not split across a page),
 * not as an escape hatch in the renderer.
 */
export type ContractItem =
  | { kind: 'text'; style: 'title' | 'heading' | 'body'; sw: string; en: string; indent?: boolean }
  | { kind: 'space'; size?: number }
  | { kind: 'group'; items: ContractItem[] };

function notOnFile(value: string | null | undefined): string {
  return value && value.trim() !== '' ? value : NOT_ON_FILE;
}

/** Digits only, Tanzanian "/=" notation - see formatShillings in shared-lib. */
function money(value: Prisma.Decimal): string {
  return formatShillings(value.toFixed(2));
}

/** "{Swahili number words} ({digits/=})" - falls back to digits only when
 *  the amount has cents or the words can't be generated (see
 *  swahili-numbers.ts's own fallback rules). Never used for anything but
 *  whole-shilling amounts printed in the contract body. */
function moneyWithWords(value: Prisma.Decimal): string {
  const digits = money(value);
  if (!value.isInteger()) {
    return digits;
  }
  const words = toSwahiliWords(value.toNumber());
  return words ? `${words} (${digits})` : digits;
}

/** Strips the "/=" suffix - for the one spot (Clause 1's daily amount, in
 *  both languages) where the source's own "TZS" immediately follows and
 *  "/= TZS" together would be redundant (Stage F3a Part 5b). Every other
 *  amount in the document keeps "/=". */
function withoutShillingSuffix(formatted: string): string {
  return formatted.replace('/=', '');
}

/** "tarehe {day} mwezi {month} {year}" - the long form used for the
 *  agreement date and the contract term's start/end dates. Null-safe. */
function longDateSw(date: Date | null): string {
  if (!date) return NOT_ON_FILE;
  return `tarehe ${date.getUTCDate()} mwezi ${MONTH_LABELS_SW[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "{day} {Month} {year}" - the short form used for the term dates'
 *  English rendering and the printed/footer timestamp in both languages.
 *  Distinct from longDateSw/the ordinal form below because the source
 *  genuinely uses three different date shapes in three different places -
 *  see Stage F3 Part 2. Null-safe. */
function shortDateSw(date: Date | null): string {
  if (!date) return NOT_ON_FILE;
  return `${date.getUTCDate()} ${MONTH_LABELS_SW[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
function shortDateEn(date: Date | null): string {
  if (!date) return NOT_ON_FILE;
  return `${date.getUTCDate()} ${MONTH_LABELS_EN[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Standard English ordinal suffix: 1st, 2nd, 3rd, 4th ... 11th/12th/13th
 *  (the -teen exceptions), 21st, 22nd, 23rd, 24th, etc. */
export function ordinal(n: number): string {
  const remainder100 = n % 100;
  if (remainder100 >= 11 && remainder100 <= 13) {
    return `${n}th`;
  }
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "the {N}{st/nd/rd/th} day of {Month} {year}" - the top agreement-date
 *  line's English form only. Always called with a real date -
 *  OwnershipPlan.createdAt is never null. */
function longDateEnOrdinal(date: Date): string {
  return `the ${ordinal(date.getUTCDate())} day of ${MONTH_LABELS_EN[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * Stage G10 (§9e) - the deposit recital, gated on downPayment > 0 exactly
 * like the fine sentence in Clause 2 below (absent entirely rather than
 * printing "0" when there is no deposit). Placed in the recital ("KWA KUWA")
 * block, next to the vehicle's own declared-value sentence - there is no
 * existing "accounts recital" in that block to sit alongside (the payment
 * destination phrase lives only in Clause 1, among the numbered terms); this
 * follows the block's own null-sentence-drop convention instead. The
 * Swahili here is an unreviewed functional translation, same caveat as the
 * rest of this file - Ibrahim to review before this ships to a real driver.
 */
function depositRecitalLine(plan: ContractContext['plan']): { sw: string; en: string } | null {
  if (!plan.downPayment.greaterThan(0)) {
    return null;
  }
  const amount = moneyWithWords(plan.downPayment);
  const amountEn = money(plan.downPayment);
  if (plan.depositHandling === DepositHandling.HELD_REFUNDABLE) {
    return {
      sw: `Dereva amelipa malipo ya awali (deposit) ya shilingi za kitanzania ${amount}, ambayo yatashikiliwa na Mmiliki na kurejeshwa baada ya Mkataba huu kukamilika.`,
      en: `The Driver has paid an initial deposit of Tanzanian shillings ${amountEn}, held by the Owner and refundable on completion of this Contract.`,
    };
  }
  return {
    sw: `Dereva amelipa malipo ya awali (deposit) ya shilingi za kitanzania ${amount}, ambayo tayari yamehesabiwa katika ratiba ya malipo iliyotajwa hapo juu.`,
    en: `The Driver has paid an initial deposit of Tanzanian shillings ${amountEn}, already credited toward the schedule set out above.`,
  };
}

function paymentAccountLine(account: ContractContext['paymentAccounts'][number]): {
  sw: string;
  en: string;
} {
  switch (account.kind) {
    case PaymentAccountKind.BANK:
      return {
        sw: `nambari ya akaunti ya ${account.provider} ${account.accountNumber} ${notOnFile(account.accountName)}`,
        en: `${account.provider} account number ${account.accountNumber}, ${notOnFile(account.accountName)}`,
      };
    case PaymentAccountKind.LIPA_NUMBER:
      return {
        sw: `Lipa namba ${account.accountNumber} (${account.provider})`,
        en: `Lipa number ${account.accountNumber} (${account.provider})`,
      };
    case PaymentAccountKind.MOBILE_MONEY:
      return {
        sw: `${account.provider} namba ${account.accountNumber}`,
        en: `${account.provider} number ${account.accountNumber}`,
      };
  }
}

/**
 * Multiple active accounts join with "au" ("or"), matching how the source
 * names a single specific destination rather than a generic channel word -
 * see the note on {{paymentChannelPhrase}} in buildContractContent below.
 * The caller always prefixes this with "Malipo yote yatafanyika " / "All
 * payments shall be made ", so the zero-accounts branch below is careful to
 * still read as two complete sentences once that prefix is applied (Stage
 * F3 Part 5) rather than running the verb straight into the fallback notice.
 */
function paymentDestinationPhrase(accounts: ContractContext['paymentAccounts']): {
  sw: string;
  en: string;
} {
  if (accounts.length === 0) {
    return {
      sw: 'kila siku. Hakuna akaunti ya malipo iliyowekwa.',
      en: 'daily. No payment account configured.',
    };
  }
  const lines = accounts.map(paymentAccountLine);
  return {
    sw: `kila siku kupitia ${lines.map((l) => l.sw).join(' au ')}.`,
    en: `daily via ${lines.map((l) => l.en).join(' or ')}.`,
  };
}

function text(
  style: 'title' | 'heading' | 'body',
  sw: string,
  en: string,
  indent?: boolean,
): ContractItem {
  return { kind: 'text', style, sw, en, indent };
}

function space(size?: number): ContractItem {
  return { kind: 'space', size };
}

/** An atomic unit for pagination purposes (Stage F3 Part 6) - the renderer
 *  measures a group's total height before drawing it and starts a new page
 *  first if it would otherwise be split. */
function group(items: ContractItem[]): ContractItem {
  return { kind: 'group', items };
}

/**
 * The full MKATABA WA MAKABIDHIANO YA PIKIPIKI content, transcribed clause by
 * clause from CONTRACT_SOURCE_SWAHILI.md (Ibrahim's real Cafrika contract).
 * Three typographical errors in the original (MMLIKI, "Mianne Ishirini na
 * tano", "hayuko hewaniambayo") are corrected here rather than reproduced -
 * see that file's header table. A fourth slip, not in that table, is also
 * fixed: the driver's paragraph has an opening paren before "Dereva" that
 * never closes, while the owner's paragraph two lines down uses the
 * identical construction correctly balanced - so the intended form is clear
 * from the document's own internal consistency, and this reproduces that
 * form rather than the stray bracket. Everything else is reproduced as
 * written.
 */
export function buildContractContent(ctx: ContractContext): ContractItem[] {
  // Stage G7 - totalOwed is dailyAmount * instalmentCount, exactly, always:
  // the driver pays a full dailyAmount on every one of instalmentCount days,
  // full stop. There is no remainder to explain, no smaller final charge, and
  // nothing to reconcile against what the Stage E daily-charge generator
  // actually bills - see ownership-plan.derivation.ts and
  // ownership-plan-generator.service.ts.
  const totalOwed = ctx.plan.dailyAmount.times(ctx.plan.instalmentCount);
  const hasValidInstalments = ctx.plan.instalmentCount > 0;
  const destination = paymentDestinationPhrase(ctx.paymentAccounts);

  const items: ContractItem[] = [];

  // Title + date of the agreement. agreementDate is OwnershipPlan.createdAt,
  // never the render timestamp - see the footer line at the end of this
  // function for the distinct, separately-printed render timestamp.
  items.push(text('title', 'MKATABA WA MAKABIDHIANO YA PIKIPIKI', 'MOTORCYCLE HANDOVER AGREEMENT'));
  items.push(space(1.5));
  items.push(
    text(
      'body',
      `Makubaliano haya yameafikiwa leo ${longDateSw(ctx.plan.agreementDate)}`,
      `This agreement was made today, ${longDateEnOrdinal(ctx.plan.agreementDate)}`,
    ),
  );
  items.push(space());

  // The parties.
  items.push(text('heading', 'KATI YA', 'BETWEEN'));
  items.push(
    text(
      'body',
      `${ctx.driver.fullName} Mkazi wa ${notOnFile(ctx.driver.residenceWard)} wilaya ya ${notOnFile(ctx.driver.residenceDistrict)} mkoa ${notOnFile(ctx.driver.residenceRegion)} mwenye nambari ya NIDA ${notOnFile(ctx.driver.nationalId)} ambaye katika makubaliano haya ataitwa ("Dereva" neno ambalo litajumuisha na warithi wake) kwa upande mmoja.`,
      `${ctx.driver.fullName}, resident of ${notOnFile(ctx.driver.residenceWard)}, ${notOnFile(ctx.driver.residenceDistrict)} district, ${notOnFile(ctx.driver.residenceRegion)} region, holder of NIDA number ${notOnFile(ctx.driver.nationalId)}, who in this agreement shall be called ("the Driver", a term which shall include his/her heirs) of the one part.`,
    ),
  );
  items.push(text('heading', 'NA', 'AND'));
  items.push(
    text(
      'body',
      `${ctx.tenant.name} ya ${notOnFile(ctx.tenant.physicalAddress)} (ajulikanae kama "Mmiliki" neno ambalo litawajumuisha na Warithi wake) kwa upande mwingine.`,
      `${ctx.tenant.name} of ${notOnFile(ctx.tenant.physicalAddress)} (known as "the Owner", a term which shall include its Heirs) of the other part.`,
    ),
  );
  items.push(space());

  // Recital identifying the vehicle.
  items.push(
    text(
      'body',
      `KWA KUWA MMILIKI ni Mmiliki halali wa ${notOnFile(ctx.vehicle.make)} iliyosajiliwa kwa namba ${ctx.vehicle.registrationNumber} yenye chasisi namba ${notOnFile(ctx.vehicle.chassisNumber)} aina ya ${notOnFile(ctx.vehicle.model)} yenye rangi ya ${notOnFile(ctx.vehicle.colour)} yenye thamani ya shilingi za kitanzania ${moneyWithWords(ctx.plan.totalPrice)}`,
      `WHEREAS THE OWNER is the lawful Owner of a ${notOnFile(ctx.vehicle.make)} registered under number ${ctx.vehicle.registrationNumber}, with chassis number ${notOnFile(ctx.vehicle.chassisNumber)}, model ${notOnFile(ctx.vehicle.model)}, colour ${notOnFile(ctx.vehicle.colour)}, with a value of Tanzanian shillings ${money(ctx.plan.totalPrice)}`,
    ),
  );
  const depositRecital = depositRecitalLine(ctx.plan);
  if (depositRecital) {
    items.push(text('body', depositRecital.sw, depositRecital.en));
  }
  items.push(
    text(
      'body',
      'NA KWA KUWA Mmiliki na Dereva wamekubaliana kuingia katika makubaliano haya kwa masharti yaliyoorodheshwa katika Mkataba huu.',
      'AND WHEREAS the Owner and the Driver have agreed to enter into this agreement on the terms set out in this Contract.',
    ),
  );
  items.push(space());

  // Start date and end date - long Swahili form (reused from the top line),
  // short English form (matching the footer's shape, not the ordinal
  // "day of" form used only for the top line).
  items.push(
    text(
      'body',
      `MKATABA huu utaanza rasmi ${longDateSw(ctx.plan.startDate)} na utaisha ${longDateSw(ctx.plan.contractEndDate)}`,
      `This AGREEMENT shall officially begin on ${shortDateEn(ctx.plan.startDate)} and shall end on ${shortDateEn(ctx.plan.contractEndDate)}`,
    ),
  );
  items.push(space());

  items.push(text('heading', 'MASHARTI YA MKATABA', 'TERMS OF THE AGREEMENT'));
  items.push(space());

  // 1. The daily obligation, the payment destination, and (Stage G7) the
  // total the driver will actually pay - the total is always
  // dailyAmount * instalmentCount, never typed or read from another field,
  // so an owner sees their own term's arithmetic before anyone signs. The
  // declared value in the recital above is a SEPARATE figure and is never
  // reconciled against this one. A final partial day can no longer exist -
  // there is nothing left to explain, round, or reconcile, so the total
  // sentence states the figure alone.
  {
    const obligationSw = `Makabidhiano ya mkataba huu ni kwamba dereva atalazimika kuwasilisha kwa mmiliki mapato ya kiasi cha shilingi ${withoutShillingSuffix(moneyWithWords(ctx.plan.dailyAmount))} TZS kila siku baada ya tarehe ya mkataba huu kwa siku ${ctx.plan.instalmentCount} mfululizo.`;
    const obligationEn = `The obligation under this agreement is that the Driver must remit to the Owner proceeds of shillings ${withoutShillingSuffix(money(ctx.plan.dailyAmount))} TZS every day after the date of this agreement, for ${ctx.plan.instalmentCount} consecutive days.`;
    const paymentSw = `Malipo yote yatafanyika ${destination.sw}`;
    const paymentEn = `All payments shall be made ${destination.en}`;

    const totalSw = hasValidInstalments
      ? `Jumla ya marejesho yote ni shilingi za kitanzania ${moneyWithWords(totalOwed)}.`
      : null;
    const totalEn = hasValidInstalments
      ? `The total of all remittances is Tanzanian shillings ${money(totalOwed)}.`
      : null;

    items.push(
      text(
        'body',
        ['1. ' + obligationSw, paymentSw, totalSw]
          .filter((part): part is string => Boolean(part))
          .join(' '),
        ['1. ' + obligationEn, paymentEn, totalEn]
          .filter((part): part is string => Boolean(part))
          .join(' '),
      ),
    );
  }
  items.push(space());

  // 2. The fine and the breach threshold - rewritten in Ibrahim's own words
  // (Stage G7 Part 3c). The fine sentence drops entirely when lateFeeAmount
  // is null, same as before; the breach sentence always prints. Day counts
  // are plain digits throughout, matching Clause 1 (Stage G7 Part 3b).
  {
    const sentencesSw = ['2. Marejesho ya kila siku ni LAZIMA.'];
    const sentencesEn = ['2. The daily remittance is MANDATORY.'];
    if (ctx.plan.lateFeeAmount !== null) {
      sentencesSw.push(
        `Dereva atalazimika kulipa faini ya shilingi ${moneyWithWords(ctx.plan.lateFeeAmount)} endapo atakosa kulipa hela siku moja bila taarifa.`,
      );
      sentencesEn.push(
        `The Driver shall be liable to pay a fine of shillings ${money(ctx.plan.lateFeeAmount)} if they fail to pay the money for one day without notice.`,
      );
    }
    sentencesSw.push(
      `Na kama atashindwa kulipa hela ndani ya siku ${ctx.plan.breachAfterConsecutiveMissedDays} mfululizo, basi atakuwa amevunja mkataba na chombo kitachukuliwa na mmiliki.`,
    );
    sentencesEn.push(
      `And if they fail to pay the money within ${ctx.plan.breachAfterConsecutiveMissedDays} consecutive days, they shall have breached the agreement and the vehicle will be taken by the Owner.`,
    );
    items.push(text('body', sentencesSw.join(' '), sentencesEn.join(' ')));
  }
  items.push(space());

  // 3. Reachability and next of kin. The guarantor block always prints, with
  // "Haijajazwa / Not on file" per field when the driver has none - a
  // missing next-of-kin block reads as an oversight, which is what it is.
  items.push(
    text(
      'body',
      '3. Dereva anabidi kupatikana katika mawasiliano na msimamizi wake kila anapotafutwa au kutoa udhuru na namba ya mtu wake wa karibu ikiwa hayuko hewani ambayo ni:',
      '3. The Driver must be reachable by their supervisor whenever sought, or give a reason, along with the number of their next of kin in case they are unreachable, which is:',
    ),
  );
  items.push(
    text(
      'body',
      `Jina: ${notOnFile(ctx.guarantor?.fullName)}    Namba ya simu: ${notOnFile(ctx.guarantor?.phone)}`,
      `Name: ${notOnFile(ctx.guarantor?.fullName)}    Phone Number: ${notOnFile(ctx.guarantor?.phone)}`,
    ),
  );
  items.push(
    text(
      'body',
      `Sahihi: ______________    Mahali anapoishi: ${notOnFile(ctx.guarantor?.residenceWard)}, ${notOnFile(ctx.guarantor?.residenceDistrict)}, ${notOnFile(ctx.guarantor?.residenceRegion)}`,
      `Signature: ______________    Residence: ${notOnFile(ctx.guarantor?.residenceWard)}, ${notOnFile(ctx.guarantor?.residenceDistrict)}, ${notOnFile(ctx.guarantor?.residenceRegion)}`,
    ),
  );
  items.push(text('body', 'Tarehe __/__/20__', 'Date __/__/20__'));
  items.push(
    text(
      'body',
      'Mabadiliko ya mawasiliano ya mtu wa karibu yafanywe mapema kabla ya udhuru kujitokeza.',
      'Changes to next-of-kin contact details should be made in advance, before the need arises.',
    ),
  );
  items.push(space());

  // 4. Maintenance splits on fault - two sentences in the original, kept two.
  items.push(
    text(
      'body',
      '4. Iwapo bodaboda itaharibika kwa makosa yasiyotokana na uzembe wa dereva mmiliki atalazimika kuitengeneza wala dereva hatohusika kwa namna yoyote ile.',
      "4. If the motorcycle breaks down due to a fault not caused by the Driver's negligence, the Owner shall be responsible for repairing it and the Driver shall not be liable in any way.",
    ),
  );
  items.push(
    text(
      'body',
      'Iwapo bodaboda itaharibika ama kupotea kwa uzembe wa dereva, dereva atalazimika kuitengeneza ama kuilipa.',
      "If the motorcycle breaks down or is lost due to the Driver's negligence, the Driver shall repair it or pay for it.",
    ),
  );
  items.push(space());

  // 5. No lending, owner may inspect.
  items.push(
    text(
      'body',
      '5. Ni marufuku kutoa ama kuazimisha pikipiki kwa mtu asiyehusika kwenye mkataba huu na Mmiliki ana haki ya kukagua pikipiki endapo atahitaji.',
      '5. It is forbidden to give out or lend the motorcycle to a person not party to this agreement, and the Owner has the right to inspect the motorcycle whenever they require.',
    ),
  );
  items.push(space());

  // 6. Right to receipts. "anahaki" corrected to "ana haki".
  items.push(
    text(
      'body',
      '6. Dereva ana haki ya kuuliza au kupewa nakala ya malipo yake anayofanya yani marejesho ataomba na ana haki ya kupewa.',
      '6. The Driver has the right to ask for or be given a copy of the payments (remittances) they make, upon request, and has the right to be given one.',
    ),
  );
  items.push(space());

  // 7. Breach ends the contract.
  items.push(
    text(
      'body',
      '7. Dereva asipo timiza hayo masharti mmiliki ana haki ya kuchukua chombo chake na mkataba utavunjwa, ama endapo mmiliki na dereva watashindwa kusimamia makubaliano haya mkataba utavunjika mara moja.',
      '7. If the Driver fails to fulfil those terms, the Owner has the right to take back their vehicle and the agreement shall be terminated, or if the Owner and the Driver fail to uphold this agreement it shall terminate immediately.',
    ),
  );
  items.push(space());

  // 8. Completion, with its three sub-points kept as sub-points - the third
  // is the liability clause and needs to be findable, not buried in prose.
  items.push(
    text(
      'body',
      '8. Dereva akiwa amekwisha maliza malipo yake yote sawa na makubaliano ya mkataba huu anatakiwa afatilie au afanye yafuatayo;',
      '8. Once the Driver has finished all their payments in accordance with this agreement, the following shall be followed or done;',
    ),
  );
  items.push(
    text(
      'body',
      'Mmiliki anatakiwa kumkabidhi pikipiki, kadi asili (original) pamoja na funguo ya ziada.',
      'The Owner shall hand over the motorcycle, the original card (registration card), together with a spare key.',
      true,
    ),
  );
  items.push(
    text(
      'body',
      'Mmiliki akishakabidhi kila kitu kilichotajwa hapo juu, dereva anatakiwa kubadili jina la kadi haraka iwezekanavyo kwa gharama zake binafsi.',
      'Once the Owner has handed over everything mentioned above, the Driver shall change the name on the card as soon as possible, at their own personal cost.',
      true,
    ),
  );
  items.push(
    text(
      'body',
      'Makabidhiano yakishafanyika na dereva ama pikipiki imehusika kwenye tukio lolote na jina halikubadilishwa la kadi hiyo basi Mmiliki hatohusika kwa jambo lolote zaidi dereva ndio atakayewajibika kwa kila kitu.',
      'Once the handover has taken place, if the motorcycle is involved in any incident while the name on that card has not yet been changed, the Owner shall bear no further liability whatsoever - the Driver alone shall be responsible for everything.',
      true,
    ),
  );
  items.push(space(2));

  // Signature blocks - the driver's, then the owner's, each with its own
  // witness block ("MBELE YANGU"). The date blanks here are signed by hand
  // and are left as literal blanks, not filled from renderedAt/agreementDate.
  // Each IMEWEKWA SAHIHI block and each MBELE YANGU witness block is wrapped
  // in `group()` (Stage F3 Part 6) so the renderer keeps it on one page
  // rather than splitting it across a page break.
  items.push(
    group([
      text(
        'body',
        `IMEWEKWA SAHIHI na KUTOLEWA hapa ${notOnFile(ctx.tenant.physicalAddress)} na ${ctx.driver.fullName}, ambaye ninamfahamu leo tarehe ____ mwezi ____________ 202__.`,
        `SIGNED and DELIVERED here at ${notOnFile(ctx.tenant.physicalAddress)} by ${ctx.driver.fullName}, whom I know, today the ____ day of ____________ 202__.`,
      ),
      text('body', 'Sahihi ya Dereva: ________________', "Driver's Signature: ________________"),
    ]),
  );
  items.push(space());
  items.push(
    group([
      text('body', 'MBELE YANGU:', 'BEFORE ME:'),
      text(
        'body',
        'Jina: ..................................................',
        'Name: ..................................................',
      ),
      text(
        'body',
        'Sahihi: ................................................',
        'Signature: ................................................',
      ),
      text(
        'body',
        'Anuani: ................................................',
        'Address: ................................................',
      ),
      text(
        'body',
        'Wadhifa: ...............................................',
        'Position: ...............................................',
      ),
    ]),
  );
  items.push(space());

  items.push(
    group([
      text('body', `IMEWEKWA SAHIHI na ${ctx.tenant.name}`, `SIGNED by ${ctx.tenant.name}`),
      text(
        'body',
        'Mbele ya Maafisa wake walioruhusiwa kushuhudia',
        'Before its duly authorised Officers as witnesses',
      ),
      text(
        'body',
        'Leo tarehe ____ mwezi ____________ 202__',
        'Today the ____ day of ____________ 202__',
      ),
      text('body', 'Sahihi ya Mmiliki: ________________', "Owner's Signature: ________________"),
      text(
        'body',
        `Jina: ${notOnFile(ctx.tenant.directorName)}`,
        `Name: ${notOnFile(ctx.tenant.directorName)}`,
      ),
      text(
        'body',
        'Sahihi: ................................................',
        'Signature: ................................................',
      ),
      text(
        'body',
        `Anuani: ${notOnFile(ctx.tenant.physicalAddress)}`,
        `Address: ${notOnFile(ctx.tenant.physicalAddress)}`,
      ),
      text(
        'body',
        `Wadhifa: MKURUGENZI WA ${ctx.tenant.name}`,
        `Position: DIRECTOR OF ${ctx.tenant.name}`,
      ),
    ]),
  );
  items.push(space());
  items.push(
    group([
      text('body', 'MBELE YANGU', 'BEFORE ME'),
      text(
        'body',
        'Jina: ..................................................',
        'Name: ..................................................',
      ),
      text(
        'body',
        'Sahihi: ................................................',
        'Signature: ................................................',
      ),
      text(
        'body',
        'Anuani: ................................................',
        'Address: ................................................',
      ),
      text(
        'body',
        'Wadhifa: ...............................................',
        'Position: ...............................................',
      ),
    ]),
  );

  // The render timestamp - a distinct fact from plan.agreementDate above, on
  // its own line, same discipline as the three balances that must never
  // merge. This is what makes a reprint identifiable as a reprint.
  items.push(space());
  items.push(
    text(
      'body',
      `Imechapishwa ${shortDateSw(ctx.renderedAt)}`,
      `Printed ${shortDateEn(ctx.renderedAt)}`,
    ),
  );

  return items;
}

/** One text item's page span (Stage F3d Part 3) - the page doc was on right
 *  before its Swahili line was drawn, and the page it was on right after its
 *  English translation was drawn. pairIndex matches contractTextPairs()'s
 *  order exactly (text items only, groups flattened, spaces skipped), so a
 *  test can correlate a span back to the pair it belongs to without ever
 *  parsing the rendered PDF's bytes back into text. startPage !== endPage
 *  means a page break landed inside this single pair - the defect Part 2
 *  fixes; this type exists so a regression back to it is a page-count
 *  comparison, not a fragile string match against rendered PDF content. */
export interface PairPageSpan {
  pairIndex: number;
  startPage: number;
  endPage: number;
}

/** Every {sw, en} pair the contract renderer emits, in render order,
 *  recursing into `group` items - the single source for
 *  CONTRACT_SWAHILI_STRINGS.txt and for content-bearing assertions in
 *  tests. */
export function contractTextPairs(ctx: ContractContext): Array<{ sw: string; en: string }> {
  const pairs: Array<{ sw: string; en: string }> = [];
  const visit = (contractItems: ContractItem[]): void => {
    for (const item of contractItems) {
      if (item.kind === 'text') {
        pairs.push({ sw: item.sw, en: item.en });
      } else if (item.kind === 'group') {
        visit(item.items);
      }
    }
  };
  visit(buildContractContent(ctx));
  return pairs;
}

const FONT_SIZE: Record<'title' | 'heading' | 'body', number> = {
  title: 18,
  heading: 13,
  body: 11,
};

const INDENT_WIDTH = 24;

/** Tracks the current 1-based page number as pdfkit adds pages - shared by
 *  reference between renderContractPdf's 'pageAdded' listener (which
 *  increments it) and renderLeafItem (which reads it around the two
 *  doc.text() calls for a pair). A plain mutable object rather than a
 *  closure variable so renderLeafItem can read the live value regardless of
 *  which page-break - the proactive one below, or pdfkit's own automatic
 *  one - actually fired. */
interface PageCounter {
  current: number;
}

/** Renders one 'text' or 'space' item - never a 'group' (the caller expands
 *  those). Shared between the top-level render loop and group rendering so
 *  there is exactly one place that turns an item into pdfkit calls - and
 *  therefore the one place (Stage F3d Part 2) that can guarantee a text
 *  item's Swahili line and its English translation are one atomic unit:
 *  pdfkit's own automatic page break can otherwise land between the two
 *  doc.text() calls below, splitting a bilingual pair across a page
 *  boundary. Measuring the pair's combined height first and forcing a page
 *  break before drawing, rather than letting pdfkit discover mid-item that
 *  it doesn't fit, holds for every clause this function ever draws -
 *  including ones added later - without each needing its own group()
 *  wrapper. `group` (Stage F3 Part 6) is a different, still-needed
 *  guarantee: several distinct pairs (e.g. a whole signature block) that
 *  must stay together as one visual unit, not just each pair internally.
 *
 *  Returns the pair's start/end page (Stage F3d Part 3) for 'text' items so
 *  the caller can report a PairPageSpan - captured here, not by the caller,
 *  because only this function knows the page immediately after the
 *  proactive addPage() above but before either doc.text() call runs. */
function renderLeafItem(
  doc: PDFKit.PDFDocument,
  item: Extract<ContractItem, { kind: 'text' | 'space' }>,
  pageCounter: PageCounter,
): { startPage: number; endPage: number } | null {
  if (item.kind === 'space') {
    doc.moveDown(item.size ?? 1);
    return null;
  }

  const height = measureLeafHeight(doc, item);
  const remaining = doc.page.height - doc.page.margins.bottom - doc.y;
  if (height > remaining) {
    doc.addPage();
  }
  const startPage = pageCounter.current;

  const align = item.style === 'title' ? 'center' : 'left';
  const indent = item.indent ? INDENT_WIDTH : 0;
  doc
    .font('Helvetica')
    .fontSize(FONT_SIZE[item.style])
    .text(item.sw, { align, underline: item.style === 'heading', indent });

  if (item.style !== 'title') {
    doc.font('Helvetica-Oblique').fontSize(9).text(item.en, { align, indent });
    doc.font('Helvetica');
  }

  return { startPage, endPage: pageCounter.current };
}

/** The vertical space a leaf item would take, without drawing it - used to
 *  decide whether a `group` fits on the remaining page (Stage F3 Part 6).
 *  Mutates and restores the doc's font/size like renderLeafItem does, since
 *  heightOfString depends on the current font. */
function measureLeafHeight(
  doc: PDFKit.PDFDocument,
  item: Extract<ContractItem, { kind: 'text' | 'space' }>,
): number {
  if (item.kind === 'space') {
    return doc.currentLineHeight() * (item.size ?? 1);
  }

  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const align = item.style === 'title' ? 'center' : 'left';
  const indent = item.indent ? INDENT_WIDTH : 0;

  doc.font('Helvetica').fontSize(FONT_SIZE[item.style]);
  let height = doc.heightOfString(item.sw, { width, align, indent });

  if (item.style !== 'title') {
    doc.font('Helvetica-Oblique').fontSize(9);
    height += doc.heightOfString(item.en, { width, align, indent });
    doc.font('Helvetica');
  }

  return height;
}

function measureGroupHeight(doc: PDFKit.PDFDocument, groupItems: ContractItem[]): number {
  return groupItems.reduce((sum, item) => {
    // Groups do not nest in practice, but sum recursively rather than assume.
    if (item.kind === 'group') {
      return sum + measureGroupHeight(doc, item.items);
    }
    return sum + measureLeafHeight(doc, item);
  }, 0);
}

/**
 * Lays out buildContractContent's items with pdfkit - Swahili line first,
 * English translation beneath it in a smaller italic face. This function
 * contains no contract text of its own; see buildContractContent.
 *
 * `indent` (Clause 8's three sub-points) shifts pdfkit's left text-start via
 * the standard `indent` text option - it offsets the FIRST line of a
 * paragraph, so a sub-point long enough to wrap would return to the normal
 * margin on its second line. Every sub-point here is short enough in
 * practice not to wrap; this is a layout nicety, not a content guarantee.
 *
 * `group` (Stage F3 Part 6) measures its own total height before drawing
 * and starts a new page first if it would otherwise be split - a signature
 * block separated from its own signature is the specific defect this fixes.
 * Ibrahim reviews the rendered PDF by eye for layout generally; this is the
 * one layout property that gets an explicit check rather than relying on
 * that review alone, because a split signature block is a correctness
 * problem in a dispute, not merely a cosmetic one.
 *
 * The optional onPairRendered callback (Stage F3d Part 3) reports each text
 * item's PairPageSpan as it is drawn - test-only instrumentation, never
 * passed by real callers, that lets a test verify every pair rendered on a
 * single page without parsing the finished PDF's bytes back into text.
 */
export function renderContractPdf(
  ctx: ContractContext,
  onPairRendered?: (span: PairPageSpan) => void,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageCounter: PageCounter = { current: 1 };
    doc.on('pageAdded', () => {
      pageCounter.current += 1;
    });
    let pairIndex = 0;

    const renderItem = (item: ContractItem): void => {
      if (item.kind === 'group') {
        const height = measureGroupHeight(doc, item.items);
        const remaining = doc.page.height - doc.page.margins.bottom - doc.y;
        if (height > remaining) {
          doc.addPage();
        }
        for (const child of item.items) {
          renderItem(child);
        }
        return;
      }
      const span = renderLeafItem(doc, item, pageCounter);
      if (span) {
        onPairRendered?.({ pairIndex, ...span });
        pairIndex += 1;
      }
    };

    for (const item of buildContractContent(ctx)) {
      renderItem(item);
    }

    doc.end();
  });
}
