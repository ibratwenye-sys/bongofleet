import { Platform } from 'react-native';
import { apiFetch, ApiError, NetworkError } from './api';
import {
  getExpenseQueue,
  setExpenseQueue,
  getPendingReceipts,
  setPendingReceipts,
} from './storage';
import type { PendingReceiptUpload, QueuedExpense, RiderExpense } from './types';

/**
 * Stage H4. A parallel module to queue.ts, not a generalisation of it:
 * queue.ts is tightly coupled to payments (QueuedPayment's shape, a
 * hardcoded POST /payments call, its own storage key), and widening it to
 * cover expenses too would risk destabilising the payment offline flow
 * that's already shipped and tested. Same reasoning this codebase already
 * used for keeping getOwnDriverId() as a private per-module copy on the
 * backend rather than a shared util - a second, separate implementation
 * that mirrors the first one's behaviour exactly.
 *
 * Two separate concerns, two separate persisted lists:
 * - the expense queue (flushExpenseQueue) holds expenses that were never
 *   even submitted yet (recorded while offline);
 * - "pending receipts" (retryPendingReceipt/flushPendingReceipts) holds
 *   expenses that HAVE been submitted (they have a real server id) but
 *   whose photo hasn't made it up - either the upload right after a
 *   successful online submission failed, or a queued expense's own
 *   follow-up upload failed once it flushed. An expense moves out of the
 *   first list and, if it needed to, into the second - the two never
 *   overlap for the same expense.
 *
 * Same conservative three-way flush semantics as queue.ts throughout:
 * success removes the item; a 4xx removes it too and reports why; a
 * network failure stops the whole loop and keeps everything from that
 * point on queued for next time.
 */
export interface ExpenseFlushResult {
  sent: number;
  rejected: Array<{ item: QueuedExpense; reason: string }>;
  remaining: number;
}

export interface PendingReceiptFlushResult {
  uploaded: number;
  rejected: Array<{ item: PendingReceiptUpload; reason: string }>;
  remaining: number;
}

export async function enqueueExpense(item: QueuedExpense): Promise<number> {
  const queue = await getExpenseQueue();
  queue.push(item);
  await setExpenseQueue(queue);
  return queue.length;
}

type UploadOutcome =
  { status: 'uploaded' } | { status: 'network' } | { status: 'rejected'; reason: string };

/** The same web-vs-native FormData construction DriverDataContext's
 *  uploadReceipt already uses for payment receipts - mirrored exactly, not
 *  reused as a shared helper (photo upload is a small enough block that
 *  duplicating it here keeps this module genuinely standalone). */
async function tryUploadReceipt(
  expenseId: string,
  photoUri: string,
  photoMimeType: string,
  photoName: string,
): Promise<UploadOutcome> {
  try {
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(photoUri)).blob();
      form.append('file', blob, photoName);
    } else {
      form.append('file', {
        uri: photoUri,
        name: photoName,
        type: photoMimeType,
      } as unknown as Blob);
    }
    await apiFetch(`/expenses/${expenseId}/receipt`, { method: 'POST', body: form });
    return { status: 'uploaded' };
  } catch (err) {
    if (err instanceof NetworkError) {
      return { status: 'network' };
    }
    if (err instanceof ApiError) {
      return { status: 'rejected', reason: err.message };
    }
    return { status: 'rejected', reason: 'Something went wrong.' };
  }
}

/**
 * Tries to upload one receipt against an expense that already has a real
 * server id, and keeps the persisted "pending receipts" list correct
 * either way - idempotent, so it's safe to call for a row that was never
 * persisted yet (the immediate attempt right after creating an expense,
 * which persists it only if this call fails on a network error) and for a
 * row that already was (a background flush pass, or the driver tapping
 * "Upload now"), which simply gets re-saved unchanged while still failing,
 * or removed once it resolves.
 */
export async function retryPendingReceipt(item: PendingReceiptUpload): Promise<UploadOutcome> {
  const outcome = await tryUploadReceipt(
    item.expenseId,
    item.photoUri,
    item.photoMimeType,
    item.photoName,
  );
  const list = await getPendingReceipts();
  const withoutThis = list.filter((p) => p.expenseId !== item.expenseId);
  if (outcome.status === 'network') {
    await setPendingReceipts([...withoutThis, item]);
  } else {
    await setPendingReceipts(withoutThis);
  }
  return outcome;
}

let flushingQueue = false;

export async function flushExpenseQueue(): Promise<ExpenseFlushResult> {
  // Re-entrancy guard, same as queue.ts's flushQueue.
  if (flushingQueue) {
    const queue = await getExpenseQueue();
    return { sent: 0, rejected: [], remaining: queue.length };
  }
  flushingQueue = true;
  try {
    const queue = await getExpenseQueue();
    const rejected: ExpenseFlushResult['rejected'] = [];
    let sent = 0;

    while (queue.length > 0) {
      const item = queue[0];
      try {
        const created = await apiFetch<RiderExpense>('/expenses/submissions', {
          method: 'POST',
          body: JSON.stringify({
            category: item.category,
            amount: item.amount,
            incurredAt: item.incurredAt,
            ...(item.description ? { description: item.description } : {}),
          }),
        });
        sent += 1;
        queue.shift();
        await setExpenseQueue(queue);

        // The expense itself is safely recorded now - a receipt-upload
        // failure from here on must never re-queue the text submission
        // again (that would double-submit it). retryPendingReceipt only
        // ever moves the photo into its own list for its own separate
        // retry.
        if (item.photoUri && item.photoMimeType && item.photoName) {
          const outcome = await retryPendingReceipt({
            expenseId: created.id,
            photoUri: item.photoUri,
            photoMimeType: item.photoMimeType,
            photoName: item.photoName,
          });
          if (outcome.status === 'rejected') {
            rejected.push({ item, reason: `Receipt: ${outcome.reason}` });
          }
        }
      } catch (error) {
        if (error instanceof NetworkError) {
          break; // still offline - keep the rest for later
        }
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          rejected.push({ item, reason: error.message });
          queue.shift();
          await setExpenseQueue(queue);
          continue;
        }
        break; // unknown/server error - retry later rather than dropping money records
      }
    }

    return { sent, rejected, remaining: queue.length };
  } finally {
    flushingQueue = false;
  }
}

let flushingReceipts = false;

/** Retries every "receipt pending upload" row against its already-known
 *  expense id, using the local file URI stashed when it was first picked -
 *  no image-picker prompt, no re-selection, just the same photo tried
 *  again. */
export async function flushPendingReceipts(): Promise<PendingReceiptFlushResult> {
  if (flushingReceipts) {
    const list = await getPendingReceipts();
    return { uploaded: 0, rejected: [], remaining: list.length };
  }
  flushingReceipts = true;
  try {
    const list = await getPendingReceipts();
    const rejected: PendingReceiptFlushResult['rejected'] = [];
    let uploaded = 0;

    while (list.length > 0) {
      const item = list[0];
      const outcome = await retryPendingReceipt(item);
      if (outcome.status === 'uploaded') {
        uploaded += 1;
        list.shift();
      } else if (outcome.status === 'rejected') {
        rejected.push({ item, reason: outcome.reason });
        list.shift();
      } else {
        break; // still offline - keep the rest for later
      }
    }

    return { uploaded, rejected, remaining: list.length };
  } finally {
    flushingReceipts = false;
  }
}
