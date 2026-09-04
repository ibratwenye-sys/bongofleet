import { Platform } from 'react-native';
import { apiFetch, ApiError, NetworkError } from './api';
import {
  getJobExpenseQueue,
  setJobExpenseQueue,
  getPendingJobReceipts,
  setPendingJobReceipts,
} from './storage';
import type { PendingReceiptUpload, QueuedExpense, RiderExpense } from './types';

/**
 * Stage DM16. A parallel module to expenseQueue.ts, not a generalisation of
 * it - same reasoning expenseQueue.ts's own top-of-file comment already
 * gives for why IT isn't a generalisation of queue.ts: coupling this
 * truck/car-driver path to the rental-rider queue's storage keys and
 * hardcoded POST /expenses/submissions call would risk destabilising an
 * already-shipped offline flow for no benefit. The only difference from
 * expenseQueue.ts is which endpoint text-field submission hits
 * (/expenses/job-submissions, not /expenses/submissions) and which storage
 * keys it persists to (storage.ts's JOB_EXPENSE_QUEUE_KEY/
 * JOB_EXPENSE_PENDING_RECEIPTS_KEY) - the receipt-upload endpoint itself
 * (POST /expenses/:id/receipt) is unchanged and shared, since a created
 * expense's id works identically regardless of which submission path made
 * it.
 *
 * Same two-phase flush semantics as expenseQueue.ts throughout: the queue
 * (flushJobExpenseQueue) holds expenses never even submitted yet (recorded
 * while offline); "pending receipts" (retryPendingJobReceipt/
 * flushPendingJobReceipts) holds expenses that HAVE been submitted (a real
 * server id) whose photo hasn't made it up yet. Same conservative three-way
 * flush outcome as expenseQueue.ts too: success removes the item; a 4xx
 * removes it and reports why; a network failure stops the loop and keeps
 * everything from that point queued for next time.
 */
export interface JobExpenseFlushResult {
  sent: number;
  rejected: Array<{ item: QueuedExpense; reason: string }>;
  remaining: number;
}

export interface PendingJobReceiptFlushResult {
  uploaded: number;
  rejected: Array<{ item: PendingReceiptUpload; reason: string }>;
  remaining: number;
}

export async function enqueueJobExpense(item: QueuedExpense): Promise<number> {
  const queue = await getJobExpenseQueue();
  queue.push(item);
  await setJobExpenseQueue(queue);
  return queue.length;
}

type UploadOutcome =
  { status: 'uploaded' } | { status: 'network' } | { status: 'rejected'; reason: string };

/** Its own small copy of the web-vs-native FormData construction, not an
 *  import from expenseQueue.ts - same "keeps this module genuinely
 *  standalone" reasoning already commented on expenseQueue.ts's own
 *  tryUploadReceipt. */
async function tryUploadJobReceipt(
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

/** Tries to upload one receipt against an expense that already has a real
 *  server id - idempotent, same as expenseQueue.ts's retryPendingReceipt. */
export async function retryPendingJobReceipt(item: PendingReceiptUpload): Promise<UploadOutcome> {
  const outcome = await tryUploadJobReceipt(
    item.expenseId,
    item.photoUri,
    item.photoMimeType,
    item.photoName,
  );
  const list = await getPendingJobReceipts();
  const withoutThis = list.filter((p) => p.expenseId !== item.expenseId);
  if (outcome.status === 'network') {
    await setPendingJobReceipts([...withoutThis, item]);
  } else {
    await setPendingJobReceipts(withoutThis);
  }
  return outcome;
}

let flushingQueue = false;

export async function flushJobExpenseQueue(): Promise<JobExpenseFlushResult> {
  if (flushingQueue) {
    const queue = await getJobExpenseQueue();
    return { sent: 0, rejected: [], remaining: queue.length };
  }
  flushingQueue = true;
  try {
    const queue = await getJobExpenseQueue();
    const rejected: JobExpenseFlushResult['rejected'] = [];
    let sent = 0;

    while (queue.length > 0) {
      const item = queue[0];
      try {
        const created = await apiFetch<RiderExpense>('/expenses/job-submissions', {
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
        await setJobExpenseQueue(queue);

        if (item.photoUri && item.photoMimeType && item.photoName) {
          const outcome = await retryPendingJobReceipt({
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
          await setJobExpenseQueue(queue);
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

export async function flushPendingJobReceipts(): Promise<PendingJobReceiptFlushResult> {
  if (flushingReceipts) {
    const list = await getPendingJobReceipts();
    return { uploaded: 0, rejected: [], remaining: list.length };
  }
  flushingReceipts = true;
  try {
    const list = await getPendingJobReceipts();
    const rejected: PendingJobReceiptFlushResult['rejected'] = [];
    let uploaded = 0;

    while (list.length > 0) {
      const item = list[0];
      const outcome = await retryPendingJobReceipt(item);
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
