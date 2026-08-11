/**
 * Regenerates SWAHILI_NUMBERS_REVIEW.txt - every number word this renderer
 * can produce, for Ibrahim to proofread directly, independent of any
 * specific contract's figures. No @bongofleet/shared-lib dependency (pure
 * number-to-words, no money formatting), so no pre-build hook is needed
 * here specifically - swahili-numbers.ts is backend source, read fresh by
 * ts-node on every run.
 *
 * Writes to the Desktop review folder, NOT the repo.
 *
 * Run: pnpm --filter backend run contract:generate-numbers-review
 */
import { promises as fs } from 'node:fs';
import { toSwahiliWords } from '../src/modules/ownership-plan/swahili-numbers';

const OUT_PATH = 'C:\\Users\\HP\\Desktop\\Bongofleet Documents\\SWAHILI_NUMBERS_REVIEW.txt';

const golden = [
  5, 14, 21, 100, 105, 134, 425, 1000, 2000, 12000, 100000, 192000, 600000, 1000000, 1608000,
  1800000,
];
const oneToThirty = Array.from({ length: 30 }, (_, i) => i + 1);
const everyTenToHundred = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const spotValues = [150, 200, 365, 500, 999];
const largeValues = [3000, 15000, 20000, 50000, 250000, 500000, 750000, 2500000, 3000000];
// Stage F3b Part 1: numbers where milioni, laki, elfu, AND the sub-1000
// remainder are all non-zero at once fall back to digits only (three
// consecutive "na"s was ruled a mis-transcription risk). 1,654,000 and
// 1,000,230 sit right next to the fallback boundary (a zero remainder, or a
// zero laki/elfu, respectively) and still print words - included so Ibrahim
// can see the boundary directly, not just the fallback cases in isolation.
const compoundValues = [1_654_000, 1_654_230, 1_000_230, 2_345_678];

const all = [
  ...golden,
  ...oneToThirty,
  ...everyTenToHundred,
  ...spotValues,
  ...largeValues,
  ...compoundValues,
];
const seen = new Set<number>();
const ordered = all.filter((n) => {
  if (seen.has(n)) return false;
  seen.add(n);
  return true;
});

async function main(): Promise<void> {
  const lines = ordered.map(
    (n) => `${n}\t${toSwahiliWords(n) ?? `(fallback - prints as digits only: ${n})`}`,
  );
  await fs.writeFile(OUT_PATH, lines.join('\n') + '\n', 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${lines.length} lines to ${OUT_PATH}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
