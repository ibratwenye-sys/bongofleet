/**
 * Stage G6 Part 2 - shared-lib's pure query-normalization logic, tested here
 * per the dashboard-has-no-test-runner rule. Rebuild shared-lib's dist/
 * before trusting a filtered run of just this file.
 */
import { normalizeSearchQuery } from '@bongofleet/shared-lib';

describe('normalizeSearchQuery', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeSearchQuery('  Juma Bakari  ')).toBe('Juma Bakari');
  });

  it('collapses internal runs of whitespace to a single space', () => {
    expect(normalizeSearchQuery('Juma    Bakari')).toBe('Juma Bakari');
  });

  it('leaves an already-normalized query unchanged', () => {
    expect(normalizeSearchQuery('Juma Bakari')).toBe('Juma Bakari');
  });

  it('reduces a whitespace-only query to an empty string', () => {
    expect(normalizeSearchQuery('   ')).toBe('');
  });

  it('is a no-op on an empty string', () => {
    expect(normalizeSearchQuery('')).toBe('');
  });
});
