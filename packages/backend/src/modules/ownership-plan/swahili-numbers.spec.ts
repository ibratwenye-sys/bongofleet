import { toSwahiliWords, numberWithWords } from './swahili-numbers';

describe('toSwahiliWords - golden table (Stage F3 Part 3)', () => {
  const cases: Array<[number, string]> = [
    [5, 'tano'],
    [14, 'kumi na nne'],
    [21, 'ishirini na moja'],
    [100, 'mia moja'],
    [105, 'mia moja na tano'],
    [134, 'mia moja thelathini na nne'],
    [425, 'mia nne ishirini na tano'], // from Ibrahim's real contract
    [1_000, 'elfu moja'],
    [2_000, 'elfu mbili'],
    [12_000, 'elfu kumi na mbili'],
    [100_000, 'laki moja'],
    [192_000, 'laki moja na elfu tisini na mbili'],
    [600_000, 'laki sita'],
    [1_000_000, 'milioni moja'],
    [1_608_000, 'milioni moja laki sita na elfu nane'],
    [1_800_000, 'milioni moja na laki nane'],
  ];

  it.each(cases)('%i -> "%s"', (n, expected) => {
    expect(toSwahiliWords(n)).toBe(expected);
  });
});

describe('toSwahiliWords - fallback (mandatory per Stage F3 Part 3)', () => {
  it('returns null at or above 1,000,000,000', () => {
    expect(toSwahiliWords(1_000_000_000)).toBeNull();
    expect(toSwahiliWords(5_000_000_000)).toBeNull();
  });

  it('returns null for a non-integer', () => {
    expect(toSwahiliWords(1800000.5)).toBeNull();
  });

  it('returns null for zero and negative numbers', () => {
    expect(toSwahiliWords(0)).toBeNull();
    expect(toSwahiliWords(-5)).toBeNull();
  });

  it('999,000,000 (just under the fallback boundary) still produces words', () => {
    expect(toSwahiliWords(999_000_000)).toBe('milioni mia tisa tisini na tisa');
  });
});

describe('numberWithWords', () => {
  it('renders "{words} ({digits})" when words are available', () => {
    expect(numberWithWords(134)).toBe('mia moja thelathini na nne (134)');
  });

  it('renders digits only when words are not available (the mandatory fallback)', () => {
    expect(numberWithWords(1_000_000_000)).toBe('1000000000');
  });
});
