// `export = doc` in @types/pdfkit - this import form is required for the
// require() interop to actually resolve to the constructor at runtime; a
// default import would silently break under this tsconfig (no
// esModuleInterop).
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');
import { Prisma } from '@prisma/client';

const WEEKDAY_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LABELS_SW = [
  'Jumapili',
  'Jumatatu',
  'Jumanne',
  'Jumatano',
  'Alhamisi',
  'Ijumaa',
  'Jumamosi',
];

export interface ContractContext {
  businessName: string;
  driverName: string;
  driverNationalId: string | null;
  vehicleMakeModel: string;
  registrationNumber: string;
  totalPrice: Prisma.Decimal;
  downPayment: Prisma.Decimal;
  dailyAmount: Prisma.Decimal;
  activeWeekdays: number[];
  graceDays: number;
  startDate: Date;
  contractEndDate: Date | null;
}

function isoDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : 'Not set';
}

function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function weekdayList(activeWeekdays: number[], labels: string[]): string {
  return [...activeWeekdays]
    .sort((a, b) => a - b)
    .map((d) => labels[d])
    .join(', ');
}

/**
 * Renders the hire-purchase contract as a PDF buffer - English first (the
 * owner's filing copy), then the same terms in Swahili (the driver's signing
 * copy) on a fresh page. Helvetica (pdfkit's default) covers Swahili's plain
 * Latin script, so no font file is bundled.
 */
export function renderContractPdf(ctx: ContractContext): Promise<Buffer> {
  const totalOwed = ctx.totalPrice.minus(ctx.downPayment);
  const instalments = totalOwed.dividedBy(ctx.dailyAmount).ceil().toNumber();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderEnglishSection(doc, ctx, totalOwed, instalments);
    doc.addPage();
    renderSwahiliSection(doc, ctx, totalOwed, instalments);

    doc.end();
  });
}

function renderEnglishSection(
  doc: PDFKit.PDFDocument,
  ctx: ContractContext,
  totalOwed: Prisma.Decimal,
  instalments: number,
): void {
  doc.fontSize(18).text('HIRE PURCHASE CONTRACT', { align: 'center' });
  doc.moveDown(1.5);

  doc.fontSize(12).text('Parties', { underline: true });
  doc.fontSize(11);
  doc.text(`Business (Owner): ${ctx.businessName}`);
  doc.text(`Driver (Buyer): ${ctx.driverName}`);
  doc.text(`Driver National ID: ${ctx.driverNationalId ?? 'Not on file'}`);
  doc.moveDown();

  doc.fontSize(12).text('Vehicle', { underline: true });
  doc.fontSize(11);
  doc.text(`Make/Model: ${ctx.vehicleMakeModel}`);
  doc.text(`Registration Number: ${ctx.registrationNumber}`);
  doc.moveDown();

  doc.fontSize(12).text('Terms', { underline: true });
  doc.fontSize(11);
  doc.text(`Total Price: ${money(ctx.totalPrice)}`);
  doc.text(`Down Payment: ${money(ctx.downPayment)}`);
  doc.text(`Total Owed: ${money(totalOwed)}`);
  doc.text(`Daily Amount: ${money(ctx.dailyAmount)} per active day`);
  doc.text(`Active Weekdays: ${weekdayList(ctx.activeWeekdays, WEEKDAY_LABELS_EN)}`);
  doc.text(`Number of Instalments: ${instalments}`);
  doc.text(`Contract Start Date: ${isoDate(ctx.startDate)}`);
  doc.text(`Contract End Date: ${isoDate(ctx.contractEndDate)}`);
  doc.text(`Grace Days: ${ctx.graceDays}`);
  doc.moveDown();

  doc.fontSize(12).text('Default', { underline: true });
  doc
    .fontSize(11)
    .text(
      `If the Driver falls more than ${ctx.graceDays} day(s) behind on the daily amount, the ` +
        "Owner may treat this contract as in default and, at the Owner's discretion, may " +
        'repossess the vehicle and/or terminate this agreement. Amounts already paid remain on ' +
        "the Driver's record.",
    );
  doc.moveDown(2);

  signatureLines(doc, 'Owner Signature', 'Driver Signature');
}

function renderSwahiliSection(
  doc: PDFKit.PDFDocument,
  ctx: ContractContext,
  totalOwed: Prisma.Decimal,
  instalments: number,
): void {
  doc.fontSize(18).text('MKATABA WA MANUNUZI KWA AWAMU', { align: 'center' });
  doc.moveDown(1.5);

  doc.fontSize(12).text('Wahusika', { underline: true });
  doc.fontSize(11);
  doc.text(`Mmiliki (Kampuni): ${ctx.businessName}`);
  doc.text(`Dereva (Mnunuzi): ${ctx.driverName}`);
  doc.text(`Namba ya Kitambulisho cha Taifa: ${ctx.driverNationalId ?? 'Haipo kwenye rekodi'}`);
  doc.moveDown();

  doc.fontSize(12).text('Gari', { underline: true });
  doc.fontSize(11);
  doc.text(`Aina/Muundo: ${ctx.vehicleMakeModel}`);
  doc.text(`Namba ya Usajili: ${ctx.registrationNumber}`);
  doc.moveDown();

  doc.fontSize(12).text('Masharti', { underline: true });
  doc.fontSize(11);
  doc.text(`Bei Kamili: ${money(ctx.totalPrice)}`);
  doc.text(`Malipo ya Awali: ${money(ctx.downPayment)}`);
  doc.text(`Kiasi Kinachodaiwa: ${money(totalOwed)}`);
  doc.text(`Kiwango cha Siku: ${money(ctx.dailyAmount)} kwa kila siku ya kazi`);
  doc.text(`Siku za Kazi: ${weekdayList(ctx.activeWeekdays, WEEKDAY_LABELS_SW)}`);
  doc.text(`Idadi ya Malipo: ${instalments}`);
  doc.text(`Tarehe ya Kuanza kwa Mkataba: ${isoDate(ctx.startDate)}`);
  doc.text(`Tarehe ya Mwisho ya Mkataba: ${isoDate(ctx.contractEndDate)}`);
  doc.text(`Siku za Neema: ${ctx.graceDays}`);
  doc.moveDown();

  doc.fontSize(12).text('Kutolipa', { underline: true });
  doc
    .fontSize(11)
    .text(
      `Iwapo Dereva atachelewa kulipa kwa zaidi ya siku ${ctx.graceDays} za deni linalodaiwa, ` +
        'Mmiliki anaweza kuchukulia mkataba huu kuwa umevunjwa na, kwa hiari yake, anaweza ' +
        'kuchukua gari na/au kusitisha mkataba huu. Kiasi ambacho tayari kimelipwa kinabaki ' +
        'kwenye rekodi ya Dereva.',
    );
  doc.moveDown(2);

  signatureLines(doc, 'Sahihi ya Mmiliki', 'Sahihi ya Dereva');
}

function signatureLines(doc: PDFKit.PDFDocument, ownerLabel: string, driverLabel: string): void {
  doc.fontSize(11);
  doc.text(`${ownerLabel}: _______________________        Date: ____________`);
  doc.moveDown(1.5);
  doc.text(`${driverLabel}: _______________________        Date: ____________`);
}
