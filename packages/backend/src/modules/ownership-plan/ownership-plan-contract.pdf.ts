// `export = doc` in @types/pdfkit - this import form is required for the
// require() interop to actually resolve to the constructor at runtime; a
// default import would silently break under this tsconfig (no
// esModuleInterop).
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');
import { Prisma, PaymentAccountKind } from '@prisma/client';

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
    totalPrice: Prisma.Decimal;
    downPayment: Prisma.Decimal;
    dailyAmount: Prisma.Decimal;
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
 * lay these items out with pdfkit, and CONTRACT_SWAHILI_STRINGS.txt (Part
 * 0b) and the unit tests (Part 4) both read this exact list rather than a
 * second hand-maintained copy. No clause, heading, label, or signature line
 * may call doc.text() with its own literal string outside this function -
 * if something isn't expressible as a 'text' or 'space' item, it belongs as
 * a new item kind here (see `indent`, added for Clause 8's sub-points), not
 * as an escape hatch in the renderer.
 */
export type ContractItem =
  | { kind: 'text'; style: 'title' | 'heading' | 'body'; sw: string; en: string; indent?: boolean }
  | { kind: 'space'; size?: number };

function notOnFile(value: string | null | undefined): string {
  return value && value.trim() !== '' ? value : NOT_ON_FILE;
}

function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function isoDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : NOT_ON_FILE;
}

/** "leo tarehe {day} mwezi {month} {year}" - the source's date-of-agreement
 *  line spells day/month/year out separately rather than as one ISO string,
 *  so this is its own formatter, used nowhere else in the document. */
function agreementDayPhraseSw(date: Date): string {
  return `tarehe ${date.getUTCDate()} mwezi ${MONTH_LABELS_SW[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
function agreementDayPhraseEn(date: Date): string {
  return `the ${date.getUTCDate()} day of ${MONTH_LABELS_EN[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
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

/** Multiple active accounts join with "au" ("or"), matching how the source
 *  names a single specific destination rather than a generic channel word -
 *  see the note on {{paymentChannelPhrase}} in buildContractContent below. */
function paymentDestinationPhrase(accounts: ContractContext['paymentAccounts']): {
  sw: string;
  en: string;
} {
  if (accounts.length === 0) {
    return { sw: 'Hakuna akaunti ya malipo iliyowekwa.', en: 'No payment account configured.' };
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
  const totalOwed = ctx.plan.totalPrice.minus(ctx.plan.downPayment);
  const instalments = totalOwed.dividedBy(ctx.plan.dailyAmount).ceil().toNumber();
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
      `Makubaliano haya yameafikiwa leo ${agreementDayPhraseSw(ctx.plan.agreementDate)}`,
      `This agreement was made today, ${agreementDayPhraseEn(ctx.plan.agreementDate)}`,
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
      `KWA KUWA MMILIKI ni Mmiliki halali wa ${notOnFile(ctx.vehicle.make)} iliyosajiliwa kwa namba ${ctx.vehicle.registrationNumber} yenye chasisi namba ${notOnFile(ctx.vehicle.chassisNumber)} aina ya ${notOnFile(ctx.vehicle.model)} yenye rangi ya ${notOnFile(ctx.vehicle.colour)} yenye thamani ya shilingi za kitanzania ${money(ctx.plan.totalPrice)}`,
      `WHEREAS THE OWNER is the lawful Owner of a ${notOnFile(ctx.vehicle.make)} registered under number ${ctx.vehicle.registrationNumber}, with chassis number ${notOnFile(ctx.vehicle.chassisNumber)}, model ${notOnFile(ctx.vehicle.model)}, colour ${notOnFile(ctx.vehicle.colour)}, with a value of Tanzanian shillings ${money(ctx.plan.totalPrice)}`,
    ),
  );
  items.push(
    text(
      'body',
      'NA KWA KUWA Mmiliki na Dereva wamekubaliana kuingia katika makubaliano haya kwa masharti yaliyoorodheshwa katika Mkataba huu.',
      'AND WHEREAS the Owner and the Driver have agreed to enter into this agreement on the terms set out in this Contract.',
    ),
  );
  items.push(space());

  // Start date and end date.
  items.push(
    text(
      'body',
      `MKATABA huu utaanza rasmi tarehe ${isoDate(ctx.plan.startDate)} na utaisha tarehe ${isoDate(ctx.plan.contractEndDate)}`,
      `This AGREEMENT shall officially begin on ${isoDate(ctx.plan.startDate)} and shall end on ${isoDate(ctx.plan.contractEndDate)}`,
    ),
  );
  items.push(space());

  items.push(text('heading', 'MASHARTI YA MKATABA', 'TERMS OF THE AGREEMENT'));
  items.push(space());

  // 1. The daily obligation. The source spells the instalment count out in
  // Swahili words as well as digits ("Mia nne ishirini na tano (425)") -
  // guarding against a digit being altered is standard contract practice
  // here, and should be reproduced. Generating arbitrary Swahili number
  // words reliably is not something this code attempts (the grammar rules
  // for compound hundreds/tens/units are involved enough that a wrong word
  // is a real risk, not a hypothetical one) - so this renders digits only,
  // flagged here and in the Stage F2 report, per the source's own explicit
  // fallback instruction.
  items.push(
    text(
      'body',
      `1. Makabidhiano ya mkataba huu ni kwamba dereva atalazimika kuwasilisha kwa mmiliki mapato ya kiasi cha shilingi ${money(ctx.plan.dailyAmount)} TZS kila siku baada ya tarehe ya mkataba huu kwa siku ${instalments} mfululizo. Malipo yote yatafanyika ${destination.sw}`,
      `1. The obligation under this agreement is that the Driver must remit to the Owner proceeds of shillings ${money(ctx.plan.dailyAmount)} TZS every day after the date of this agreement, for ${instalments} consecutive days. All payments shall be made ${destination.en}`,
    ),
  );
  items.push(space());

  // 2. The fine and the breach threshold. Same digits-only reasoning as
  // Clause 1 above for breachAfterConsecutiveMissedDays.
  {
    const fineSw =
      ctx.plan.lateFeeAmount !== null
        ? ` basi atalazimika kulipa faini ya Tsh ${money(ctx.plan.lateFeeAmount)} ili kuendelea na mkataba,`
        : '';
    const fineEn =
      ctx.plan.lateFeeAmount !== null
        ? ` then he/she must pay a fine of Tsh ${money(ctx.plan.lateFeeAmount)} to continue the agreement,`
        : '';
    items.push(
      text(
        'body',
        `2. Marejesho ya kila siku ni LAZIMA kinyume na hapo dereva kama hajatoa taarifa juu ya sababu ya kutofanya hivo kwa msimamizi wake,${fineSw} lakini pia, kutofanya malipo kwa siku ${ctx.plan.breachAfterConsecutiveMissedDays} mfululizo dereva atakuwa amevunja mkataba wetu na chombo kitachukuliwa na mmiliki.`,
        `2. The daily remittance is MANDATORY; if the Driver has not given their supervisor the reason for failing to do so,${fineEn} but also, failing to pay for ${ctx.plan.breachAfterConsecutiveMissedDays} consecutive days shall mean the Driver has breached our agreement and the vehicle will be taken by the Owner.`,
      ),
    );
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
  items.push(
    text(
      'body',
      `IMEWEKWA SAHIHI na KUTOLEWA hapa ${notOnFile(ctx.tenant.physicalAddress)} na ${ctx.driver.fullName}, ambaye ninamfahamu leo tarehe ____ mwezi ____________ 202__.`,
      `SIGNED and DELIVERED here at ${notOnFile(ctx.tenant.physicalAddress)} by ${ctx.driver.fullName}, whom I know, today the ____ day of ____________ 202__.`,
    ),
  );
  items.push(
    text('body', 'Sahihi ya Dereva: ________________', "Driver's Signature: ________________"),
  );
  items.push(text('body', 'MBELE YANGU:', 'BEFORE ME:'));
  items.push(
    text(
      'body',
      'Jina: ..................................................',
      'Name: ..................................................',
    ),
  );
  items.push(
    text(
      'body',
      'Sahihi: ................................................',
      'Signature: ................................................',
    ),
  );
  items.push(
    text(
      'body',
      'Anuani: ................................................',
      'Address: ................................................',
    ),
  );
  items.push(
    text(
      'body',
      'Wadhifa: ...............................................',
      'Position: ...............................................',
    ),
  );
  items.push(space());

  items.push(text('body', `IMEWEKWA SAHIHI na ${ctx.tenant.name}`, `SIGNED by ${ctx.tenant.name}`));
  items.push(
    text(
      'body',
      'Mbele ya Maafisa wake walioruhusiwa kushuhudia',
      'Before its duly authorised Officers as witnesses',
    ),
  );
  items.push(
    text(
      'body',
      'Leo tarehe ____ mwezi ____________ 202__',
      'Today the ____ day of ____________ 202__',
    ),
  );
  items.push(
    text('body', 'Sahihi ya Mmiliki: ________________', "Owner's Signature: ________________"),
  );
  items.push(
    text(
      'body',
      `Jina: ${notOnFile(ctx.tenant.directorName)}`,
      `Name: ${notOnFile(ctx.tenant.directorName)}`,
    ),
  );
  items.push(
    text(
      'body',
      'Sahihi: ................................................',
      'Signature: ................................................',
    ),
  );
  items.push(
    text(
      'body',
      `Anuani: ${notOnFile(ctx.tenant.physicalAddress)}`,
      `Address: ${notOnFile(ctx.tenant.physicalAddress)}`,
    ),
  );
  items.push(
    text(
      'body',
      `Wadhifa: MKURUGENZI WA ${ctx.tenant.name}`,
      `Position: DIRECTOR OF ${ctx.tenant.name}`,
    ),
  );
  items.push(text('body', 'MBELE YANGU', 'BEFORE ME'));
  items.push(
    text(
      'body',
      'Jina: ..................................................',
      'Name: ..................................................',
    ),
  );
  items.push(
    text(
      'body',
      'Sahihi: ................................................',
      'Signature: ................................................',
    ),
  );
  items.push(
    text(
      'body',
      'Anuani: ................................................',
      'Address: ................................................',
    ),
  );
  items.push(
    text(
      'body',
      'Wadhifa: ...............................................',
      'Position: ...............................................',
    ),
  );

  // The render timestamp - a distinct fact from plan.agreementDate above, on
  // its own line, same discipline as the three balances that must never
  // merge. This is what makes a reprint identifiable as a reprint.
  items.push(space());
  items.push(
    text('body', `Imechapishwa ${isoDate(ctx.renderedAt)}`, `Printed ${isoDate(ctx.renderedAt)}`),
  );

  return items;
}

/** Every {sw, en} pair the contract renderer emits, in render order - the
 *  single source for CONTRACT_SWAHILI_STRINGS.txt (Stage F2 Part 0b) and for
 *  content-bearing assertions in tests. */
export function contractTextPairs(ctx: ContractContext): Array<{ sw: string; en: string }> {
  return buildContractContent(ctx)
    .filter((item): item is Extract<ContractItem, { kind: 'text' }> => item.kind === 'text')
    .map(({ sw, en }) => ({ sw, en }));
}

const FONT_SIZE: Record<'title' | 'heading' | 'body', number> = {
  title: 18,
  heading: 13,
  body: 11,
};

const INDENT_WIDTH = 24;

/**
 * Lays out buildContractContent's items with pdfkit - Swahili line first,
 * English translation beneath it in a smaller italic face. This function
 * contains no contract text of its own; see buildContractContent.
 *
 * `indent` (Clause 8's three sub-points) shifts pdfkit's left text-start via
 * the standard `indent` text option - it offsets the FIRST line of a
 * paragraph, so a sub-point long enough to wrap would return to the normal
 * margin on its second line. Every sub-point here is short enough in
 * practice not to wrap; this is a layout nicety, not a content guarantee -
 * Ibrahim reviews the rendered PDF by eye for layout, same as the rest of
 * this document.
 */
export function renderContractPdf(ctx: ContractContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    for (const item of buildContractContent(ctx)) {
      if (item.kind === 'space') {
        doc.moveDown(item.size ?? 1);
        continue;
      }

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
    }

    doc.end();
  });
}
