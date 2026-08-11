/**
 * Regenerates EVERY review artifact Ibrahim proofreads from, in one command
 * (Stage F3d Part 1): the three contract PDFs (layout and pagination - the
 * one thing the content-model unit tests cannot see, a clause drawn off the
 * bottom of a page passes every text assertion) AND both copies of
 * CONTRACT_SWAHILI_STRINGS.txt - the repo-root tracked copy and the
 * Desktop review-folder copy.
 *
 * Before this, the review-folder copy of CONTRACT_SWAHILI_STRINGS.txt had no
 * script writing to it at all - someone had hand-copied it into the review
 * folder once (Stage F3a) and nothing ever refreshed it again, so it silently
 * fell behind Stage F3b and F3c while the PDFs and the repo-root copy moved
 * on. Both copies are now built here from the exact same
 * buildSwahiliStringsDump() (see contract-swahili-dump.ts) that
 * dump-contract-swahili-strings.ts uses for the repo-root copy on its own -
 * one function, two destinations, so they cannot diverge from each other or
 * from the real renderer again.
 *
 * The PDFs and the review-folder text copy write to the Desktop review
 * folder, NOT the repo - they carry plausible NIDA numbers and must never be
 * committed. The repo-root text copy is the proofread reference under
 * version control and is safe to commit.
 *
 * Depends on @bongofleet/shared-lib's compiled output (formatShillings) -
 * the "precontract:generate-samples" script rebuilds it first, so this
 * always reflects current source even if shared-lib's dist is stale or
 * missing.
 *
 * Run: pnpm --filter backend run contract:generate-samples
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { renderContractPdf } from '../src/modules/ownership-plan/ownership-plan-contract.pdf';
import { buildSwahiliStringsDump } from './contract-swahili-dump';
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

  const dump = buildSwahiliStringsDump(FULL_SAMPLE_CONTEXT);

  const reviewFolderPath = `${OUT_DIR}\\CONTRACT_SWAHILI_STRINGS.txt`;
  await fs.writeFile(reviewFolderPath, dump, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${reviewFolderPath}`);

  const repoRootPath = path.join(__dirname, '../../../CONTRACT_SWAHILI_STRINGS.txt');
  await fs.writeFile(repoRootPath, dump, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${repoRootPath}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
