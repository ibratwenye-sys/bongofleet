import { apiFetch, ApiError, NetworkError } from './api';
import { getGpsQueue, setGpsQueue } from './storage';
import type { QueuedGpsFix } from './types';

/**
 * Stage I1 (DESIGN_GPS_TRACKING.md §4). A parallel module to queue.ts/
 * expenseQueue.ts, not a generalisation of either - same reasoning both
 * already used (queue.ts's own comment, restated in expenseQueue.ts):
 * coupling this to an already-shipped queue with a different shape risks
 * destabilising it for no benefit. Own storage key (storage.ts), and
 * genuinely different flush semantics, because a GPS fix is not money or a
 * driver-authored record:
 *
 * - capped at MAX_QUEUED_FIXES, dropping the OLDEST fixes first once full
 *   ("a week offline should not fill the phone" - the newest fixes are what
 *   is actually useful once reconnected, not the oldest);
 * - flushed as ONE batch request (POST /gps/phone takes up to 500 fixes at
 *   once - see RecordPhoneFixesDto's @ArrayMaxSize server-side, which this
 *   module's cap deliberately matches), not one request per item the way
 *   queue.ts/expenseQueue.ts flush payments/expenses one at a time;
 * - the server's per-fix accept/discard split (a fix whose date has no
 *   assignment) is not something this module retries - the whole buffer
 *   clears once the request itself succeeds, discarded or not, because a
 *   fix discarded for having no assignment that date will never succeed on
 *   a later retry either.
 */

// Matches RecordPhoneFixesDto's @ArrayMaxSize(500) server-side exactly - see
// that DTO's own comment for why the two must agree.
export const MAX_QUEUED_FIXES = 500;

export interface GpsFlushResult {
  sent: number;
  discarded: number;
}

export async function enqueueGpsFix(fix: QueuedGpsFix): Promise<void> {
  const queue = await getGpsQueue();
  queue.push(fix);
  while (queue.length > MAX_QUEUED_FIXES) {
    queue.shift(); // drop oldest first
  }
  await setGpsQueue(queue);
}

let flushing = false;

/**
 * Sends the whole buffer as one batch and clears it on any resolution other
 * than "still offline". Returns null when nothing happened (already
 * flushing, or still offline) so the caller can tell "nothing to report"
 * apart from "zero fixes were queued".
 */
export async function flushGpsQueue(): Promise<GpsFlushResult | null> {
  if (flushing) {
    return null;
  }
  flushing = true;
  try {
    const queue = await getGpsQueue();
    if (queue.length === 0) {
      return { sent: 0, discarded: 0 };
    }
    try {
      const result = await apiFetch<{ accepted: number; discarded: number }>('/gps/phone', {
        method: 'POST',
        body: JSON.stringify({ fixes: queue }),
      });
      await setGpsQueue([]);
      return { sent: result.accepted, discarded: result.discarded };
    } catch (error) {
      if (error instanceof NetworkError) {
        return null; // still offline - keep everything queued for later
      }
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        // Not retryable by sending the exact same batch again (malformed,
        // or every fix's date genuinely has no assignment) - clear it
        // rather than looping forever on a request that can never succeed.
        await setGpsQueue([]);
        return { sent: 0, discarded: queue.length };
      }
      return null; // unknown/server error - retry later
    }
  } finally {
    flushing = false;
  }
}
