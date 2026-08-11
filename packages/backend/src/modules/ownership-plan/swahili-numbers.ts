/**
 * Swahili number words for the hire-purchase contract (Stage F3 Part 3) -
 * "Mia nne ishirini na tano (425)" style, matching Ibrahim's real contract.
 *
 * Decomposed largest-first into four groups: milioni (1,000,000s), laki
 * (100,000s - Tanzanian usage, not "elfu mia"), elfu (1,000s), and a
 * remainder under 1,000. Two DIFFERENT "na" ("and") rules apply, and they
 * are not interchangeable:
 *
 *   (a) Inside the sub-1000 remainder, "na" goes before the tens/units
 *       tail ONLY when that tail renders as a single word (a bare digit
 *       1-9, "kumi", or an exact multiple of ten with no units) - e.g.
 *       "mia moja na tano" (105), "mia moja na kumi" (110), but "mia nne
 *       ishirini na tano" (425, no extra na) because "ishirini na tano"
 *       already reads as a compound.
 *   (b) Between the four large groups, "na" goes before the FINAL non-zero
 *       group only, always - e.g. "milioni moja na laki nane" (1,800,000,
 *       two groups) vs "milioni moja laki sita na elfu nane" (1,608,000,
 *       three groups: only the last join gets "na").
 *
 * Deliberately conservative: returns null (never a guessed/partial word)
 * for anything outside 1..999,999,999, or a non-integer - callers fall
 * back to digits-only. A wrong word on a signed contract is worse than a
 * missing one.
 *
 * One more fallback, added in Stage F3b: when milioni, laki, elfu AND the
 * sub-1000 remainder are ALL non-zero at once (e.g. 1,654,230 ->
 * "milioni moja laki sita elfu hamsini na nne na mia mbili na thelathini"),
 * rules (a) and (b) each fire correctly but the result carries three
 * consecutive "na"s - dense enough to be a mis-transcription risk on a
 * signed document, which is exactly what a fallback exists for. Any number
 * with a zero remainder (1,608,000, 1,800,000, ...) is unaffected and keeps
 * its words - the fallback is specifically the four-simultaneous-groups
 * case, not "any large number".
 */

const UNITS_SW = ['', 'moja', 'mbili', 'tatu', 'nne', 'tano', 'sita', 'saba', 'nane', 'tisa'];
const TENS_SW = [
  '',
  '',
  'ishirini',
  'thelathini',
  'arobaini',
  'hamsini',
  'sitini',
  'sabini',
  'themanini',
  'tisini',
];

/** 0-99. Empty string for 0 - callers never surface a bare zero. */
function wordsUnder100(n: number): string {
  if (n === 0) return '';
  if (n < 10) return UNITS_SW[n];
  if (n < 20) {
    const rem = n - 10;
    return rem === 0 ? 'kumi' : `kumi na ${UNITS_SW[rem]}`;
  }
  const tens = Math.floor(n / 10);
  const units = n % 10;
  return units === 0 ? TENS_SW[tens] : `${TENS_SW[tens]} na ${UNITS_SW[units]}`;
}

/** 0-999, rule (a) above. Empty string for 0. */
function wordsUnder1000(n: number): string {
  if (n === 0) return '';
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const restWords = wordsUnder100(rest);

  if (hundreds === 0) return restWords;

  const hundredsWords = `mia ${UNITS_SW[hundreds]}`;
  if (rest === 0) return hundredsWords;

  // A multi-word tail (e.g. "ishirini na tano") already reads as a
  // compound and takes no further "na"; a single-word tail (a bare digit,
  // "kumi", or an exact ten) needs one inserted before it.
  const joiner = restWords.includes(' ') ? ' ' : ' na ';
  return `${hundredsWords}${joiner}${restWords}`;
}

const GROUPS: Array<{ value: number; word: string }> = [
  { value: 1_000_000, word: 'milioni' },
  { value: 100_000, word: 'laki' },
  { value: 1_000, word: 'elfu' },
];

/**
 * Whole numbers 1..999,999,999 only. Anything else (zero, negative,
 * non-integer, >= 1 billion) returns null rather than a guess.
 */
export function toSwahiliWords(n: number): string | null {
  if (!Number.isInteger(n) || n <= 0 || n >= 1_000_000_000) {
    return null;
  }

  const counts: number[] = [];
  let remaining = n;
  for (const { value } of GROUPS) {
    counts.push(Math.floor(remaining / value));
    remaining %= value;
  }
  const [milioniCount, lakiCount, elfuCount] = counts;

  // Stage F3b: all four groups non-zero at once - fall back rather than
  // stack three "na"s. See the doc comment above.
  if (milioniCount > 0 && lakiCount > 0 && elfuCount > 0 && remaining > 0) {
    return null;
  }

  const groupPhrases: string[] = [];
  for (const [index, { word }] of GROUPS.entries()) {
    const count = counts[index];
    if (count > 0) {
      const countWords = wordsUnder1000(count);
      if (!countWords) return null;
      groupPhrases.push(`${word} ${countWords}`);
    }
  }
  if (remaining > 0) {
    const remainderWords = wordsUnder1000(remaining);
    if (!remainderWords) return null;
    groupPhrases.push(remainderWords);
  }

  if (groupPhrases.length === 0) return null;
  if (groupPhrases.length === 1) return groupPhrases[0];

  // Rule (b): "na" only before the last group; earlier joins are plain spaces.
  const last = groupPhrases[groupPhrases.length - 1];
  const rest = groupPhrases.slice(0, -1).join(' ');
  return `${rest} na ${last}`;
}

/** "{words} ({n})" for a plain count (day counts) - digits only if the
 *  words can't be generated. */
export function numberWithWords(n: number): string {
  const words = toSwahiliWords(n);
  return words ? `${words} (${n})` : `${n}`;
}
