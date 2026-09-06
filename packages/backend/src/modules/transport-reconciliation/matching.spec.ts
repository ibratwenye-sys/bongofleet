import { matchStatementRow, normalizeForMatching, JobCandidate } from './matching';

function job(overrides: Partial<JobCandidate> = {}): JobCandidate {
  return {
    id: 'job-1',
    reference: 'BF-7QK2M91X',
    customerName: 'Mbeya Kilimo Ltd',
    revenue: 450000,
    amountReceived: 0,
    ...overrides,
  };
}

describe('normalizeForMatching', () => {
  it('uppercases and strips everything except letters and digits', () => {
    expect(normalizeForMatching('bf-7qk2m91x')).toBe('BF7QK2M91X');
    expect(normalizeForMatching('BF 7QK2M91X')).toBe('BF7QK2M91X');
    expect(normalizeForMatching('Ref: BF-7QK2M91X (transport)')).toBe('REFBF7QK2M91XTRANSPORT');
  });
});

describe('matchStatementRow', () => {
  it('matches a reference despite realistic statement mangling (dashes stripped, lowercase, extra spaces)', () => {
    const target = job({ id: 'job-1', reference: 'BF-7QK2M91X' });
    const other = job({ id: 'job-2', reference: 'BF-9ZZZZZZZ' });

    const result = matchStatementRow(
      { amount: 450000, narrative: 'MPESA PAYMENT bf 7qk2m91x THANK YOU' },
      [target, other],
    );

    expect(result).toEqual([
      {
        jobId: 'job-1',
        reference: 'BF-7QK2M91X',
        customerName: 'Mbeya Kilimo Ltd',
        remainingBalance: 450000,
        matchReason: 'reference',
      },
    ]);
  });

  it('offers every reference match when more than one collides in the normalized narrative, without picking one', () => {
    const jobA = job({ id: 'job-a', reference: 'BF-AAAA1111' });
    const jobB = job({ id: 'job-b', reference: 'BF-BBBB2222' });
    const unrelated = job({ id: 'job-c', reference: 'BF-CCCC3333' });

    const result = matchStatementRow(
      { amount: 1000, narrative: 'BF-AAAA1111 and BF-BBBB2222 combined' },
      [jobA, jobB, unrelated],
    );

    expect(result.map((m) => m.jobId).sort()).toEqual(['job-a', 'job-b']);
    expect(result.every((m) => m.matchReason === 'reference')).toBe(true);
  });

  it('falls back to an amount match only when there is no reference match at all', () => {
    const target = job({
      id: 'job-1',
      reference: 'BF-7QK2M91X',
      revenue: 300000,
      amountReceived: 0,
    });

    const result = matchStatementRow(
      { amount: 300000, narrative: 'MPESA CONFIRMATION - no reference here' },
      [target],
    );

    expect(result).toEqual([
      expect.objectContaining({ jobId: 'job-1', matchReason: 'amount', remainingBalance: 300000 }),
    ]);
  });

  it('offers every job with a matching remaining balance, none pre-selected, when amount-matching', () => {
    const jobA = job({ id: 'job-a', reference: 'BF-AAAA1111', revenue: 50000, amountReceived: 0 });
    const jobB = job({ id: 'job-b', reference: 'BF-BBBB2222', revenue: 50000, amountReceived: 0 });

    const result = matchStatementRow({ amount: 50000, narrative: 'no reference at all' }, [
      jobA,
      jobB,
    ]);

    expect(result.map((m) => m.jobId).sort()).toEqual(['job-a', 'job-b']);
    expect(result.every((m) => m.matchReason === 'amount')).toBe(true);
  });

  it('returns zero matches when nothing lines up on reference or amount', () => {
    const target = job({ reference: 'BF-7QK2M91X', revenue: 450000, amountReceived: 0 });

    const result = matchStatementRow({ amount: 12345, narrative: 'completely unrelated text' }, [
      target,
    ]);

    expect(result).toEqual([]);
  });

  it('never offers a job whose amountReceived already equals or exceeds revenue, even if handed one', () => {
    const fullyPaid = job({
      id: 'job-paid',
      reference: 'BF-7QK2M91X',
      revenue: 100000,
      amountReceived: 100000,
    });
    const overpaid = job({
      id: 'job-over',
      reference: 'BF-8ZZZZZZZ',
      revenue: 100000,
      amountReceived: 150000,
    });

    // Reference would otherwise match both; amount-fallback would otherwise
    // match neither being needed since a reference exists in the text.
    const result = matchStatementRow(
      { amount: 100000, narrative: 'BF-7QK2M91X and BF-8ZZZZZZZ both mentioned' },
      [fullyPaid, overpaid],
    );

    expect(result).toEqual([]);
  });
});
