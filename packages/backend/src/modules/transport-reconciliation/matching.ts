/**
 * TRANSPORT_DESIGN.md §6 - the manual statement-reconciliation matching
 * algorithm. Pure and DB-free on purpose, same "pass in what you've
 * already fetched" convention as gps/current-position.ts's
 * resolveCurrentPosition and expense.service.ts's deriveOverCapFlags -
 * testable without Prisma mock plumbing. The batched Prisma fetch that
 * supplies `outstandingJobs` lives on TransportReconciliationService.
 */

export type MatchReason = 'reference' | 'amount';

export interface JobCandidate {
  id: string;
  reference: string | null;
  customerName: string | null;
  revenue: number;
  amountReceived: number;
}

export interface StatementRowForMatching {
  amount: number;
  narrative: string;
}

export interface MatchCandidate {
  jobId: string;
  reference: string | null;
  customerName: string | null;
  remainingBalance: number;
  matchReason: MatchReason;
}

/**
 * Bank/mobile-money statements routinely mangle a reference like
 * "BF-7QK2M91X" into "bf7qk2m91x", "BF 7QK2M91X", or truncate/pad it - a
 * raw substring match would miss all of these. Uppercase, strip everything
 * except letters and digits, on both sides of a comparison.
 */
export function normalizeForMatching(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Money-safe equality at the cent - avoids float-drift false negatives/
 *  positives a plain `===` on two decimals derived independently could hit. */
function centsEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

/**
 * For one statement row, against a tenant's candidate jobs: a reference
 * match wins outright whenever at least one exists (there can genuinely be
 * more than one if references collide in the normalized text - all are
 * offered, none silently picked). Only when there is NO reference match at
 * all does this fall back to an amount match: any outstanding job whose
 * remaining balance exactly equals the row's amount - a weaker signal,
 * every match offered, none pre-selected.
 *
 * Jobs with amountReceived >= revenue (nothing left owed) are excluded
 * from consideration here directly, defensively - not merely left to the
 * caller's own pre-filtered query, so this function is correct even if
 * handed an unfiltered list.
 */
export function matchStatementRow(
  row: StatementRowForMatching,
  candidateJobs: JobCandidate[],
): MatchCandidate[] {
  const outstanding = candidateJobs.filter((job) => job.amountReceived < job.revenue);
  const normalizedNarrative = normalizeForMatching(row.narrative);

  const referenceMatches: MatchCandidate[] = [];
  for (const job of outstanding) {
    if (!job.reference) continue;
    const normalizedReference = normalizeForMatching(job.reference);
    if (normalizedReference.length === 0) continue;
    if (normalizedNarrative.includes(normalizedReference)) {
      referenceMatches.push({
        jobId: job.id,
        reference: job.reference,
        customerName: job.customerName,
        remainingBalance: job.revenue - job.amountReceived,
        matchReason: 'reference',
      });
    }
  }
  if (referenceMatches.length > 0) {
    return referenceMatches;
  }

  const amountMatches: MatchCandidate[] = [];
  for (const job of outstanding) {
    const remaining = job.revenue - job.amountReceived;
    if (centsEqual(remaining, row.amount)) {
      amountMatches.push({
        jobId: job.id,
        reference: job.reference,
        customerName: job.customerName,
        remainingBalance: remaining,
        matchReason: 'amount',
      });
    }
  }
  return amountMatches;
}
