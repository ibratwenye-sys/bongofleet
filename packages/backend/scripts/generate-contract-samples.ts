/**
 * Regenerates the two contract review PDFs Ibrahim reads for layout and
 * pagination - the one thing the content-model unit tests cannot see (a
 * clause drawn off the bottom of a page passes every text assertion).
 *
 * Writes to the Desktop review folder, NOT the repo - these carry plausible
 * NIDA numbers and must never be committed.
 *
 * Depends on @bongofleet/shared-lib's compiled output (formatShillings) -
 * the "precontract:generate-samples" script rebuilds it first, so this
 * always reflects current source even if shared-lib's dist is stale or
 * missing.
 *
 * Run: pnpm --filter backend run contract:generate-samples
 */
import { promises as fs } from 'node:fs';
import { renderContractPdf } from '../src/modules/ownership-plan/ownership-plan-contract.pdf';
import {
  FULL_SAMPLE_CONTEXT,
  SPARSE_SAMPLE_CONTEXT,
  REMAINDER_SAMPLE_CONTEXT,
} from './contract-sample-fixture';

const OUT_DIR = 'C:\\Users\\HP\\Desktop\\Bongofleet Documents';

async function main(): Promise<void> {
  const full = await renderContractPdf(FULL_SAMPLE_CONTEXT);
  await fs.writeFile(`${OUT_DIR}\\SAMPLE_CONTRACT.pdf`, full);
  // eslint-disable-next-line no-console
  console.log(`Wrote SAMPLE_CONTRACT.pdf (${full.length} bytes)`);

  const sparse = await renderContractPdf(SPARSE_SAMPLE_CONTEXT);
  await fs.writeFile(`${OUT_DIR}\\SAMPLE_CONTRACT_SPARSE.pdf`, sparse);
  // eslint-disable-next-line no-console
  console.log(`Wrote SAMPLE_CONTRACT_SPARSE.pdf (${sparse.length} bytes)`);

  // Stage F3c Part 2: totalOwed 1,608,500 is not an exact multiple of the
  // 12,000 daily amount - the one permanent sample that shows the fullDays +
  // final-day-remainder clause and would catch a regression back to
  // days x dailyAmount.
  const remainder = await renderContractPdf(REMAINDER_SAMPLE_CONTEXT);
  await fs.writeFile(`${OUT_DIR}\\SAMPLE_CONTRACT_REMAINDER.pdf`, remainder);
  // eslint-disable-next-line no-console
  console.log(`Wrote SAMPLE_CONTRACT_REMAINDER.pdf (${remainder.length} bytes)`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
