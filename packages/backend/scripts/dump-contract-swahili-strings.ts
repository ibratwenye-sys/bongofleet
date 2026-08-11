/**
 * Regenerates CONTRACT_SWAHILI_STRINGS.txt at the repo root from the same
 * buildContractContent() the real PDF renderer uses (see
 * ownership-plan-contract.pdf.ts) - never hand-copy these strings elsewhere,
 * or the proofread file drifts from the actual contract the first time a
 * clause changes. See contract-swahili-dump.ts for the shared writer this
 * and generate-contract-samples.ts's own review-folder copy both use
 * (Stage F3d Part 1 - the two copies drifted before that was shared).
 *
 * Depends on @bongofleet/shared-lib's compiled output (formatShillings) -
 * the "precontract:dump-swahili" script rebuilds it first, so this always
 * reflects the current source even if shared-lib's dist is stale or missing.
 *
 * Run: pnpm --filter backend run contract:dump-swahili - or, to regenerate
 * this alongside every other review artifact in one command, run
 * contract:generate-samples, which now runs this too.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { buildSwahiliStringsDump } from './contract-swahili-dump';
import { FULL_SAMPLE_CONTEXT } from './contract-sample-fixture';

async function main(): Promise<void> {
  const content = buildSwahiliStringsDump(FULL_SAMPLE_CONTEXT);
  const outPath = path.join(__dirname, '../../../CONTRACT_SWAHILI_STRINGS.txt');
  await fs.writeFile(outPath, content, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${content.trim().split('\n').length} lines to ${outPath}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
