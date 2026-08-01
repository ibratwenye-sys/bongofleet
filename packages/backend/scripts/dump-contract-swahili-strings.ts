/**
 * Regenerates CONTRACT_SWAHILI_STRINGS.txt at the repo root from the same
 * buildContractContent() the real PDF renderer uses (see
 * ownership-plan-contract.pdf.ts) - never hand-copy these strings elsewhere,
 * or the proofread file drifts from the actual contract the first time a
 * clause changes.
 *
 * Depends on @bongofleet/shared-lib's compiled output (formatShillings) -
 * the "precontract:dump-swahili" script rebuilds it first, so this always
 * reflects the current source even if shared-lib's dist is stale or missing.
 *
 * Run: pnpm --filter backend run contract:dump-swahili
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { contractTextPairs } from '../src/modules/ownership-plan/ownership-plan-contract.pdf';
import { FULL_SAMPLE_CONTEXT } from './contract-sample-fixture';

async function main(): Promise<void> {
  const pairs = contractTextPairs(FULL_SAMPLE_CONTEXT);
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
