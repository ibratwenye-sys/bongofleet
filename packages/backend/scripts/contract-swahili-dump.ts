/**
 * Stage F3d Part 1 - the one place that turns buildContractContent's
 * {sw, en} pairs into the tab-separated text both CONTRACT_SWAHILI_STRINGS.txt
 * copies are made of: the repo-root tracked copy (dump-contract-swahili-
 * strings.ts) and the Desktop review-folder copy Ibrahim actually proofreads
 * from (generate-contract-samples.ts). Before this, only the repo-root copy
 * was ever regenerated - the review-folder copy had no script writing to it
 * at all, so it silently held Stage F3a's wording through F3b and F3c. Both
 * writers now call this one function so the two copies can never diverge
 * from each other or from the real renderer again.
 */
import {
  contractTextPairs,
  ContractContext,
} from '../src/modules/ownership-plan/ownership-plan-contract.pdf';

export function buildSwahiliStringsDump(ctx: ContractContext): string {
  const pairs = contractTextPairs(ctx);
  return pairs.map(({ sw, en }) => `${sw}\t${en}`).join('\n') + '\n';
}
