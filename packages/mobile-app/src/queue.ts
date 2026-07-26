import { apiFetch, ApiError, NetworkError } from './api';
import { getQueue, setQueue } from './storage';
import type { Payment, QueuedPayment } from './types';

/**
 * Offline payment queue. A payment the driver records while the phone has no
 * signal is stored locally and pushed to the server later. Flushing is
 * sequential and conservative:
 * - success -> item removed from the queue;
 * - a 4xx from the server (validation/conflict) -> item removed too, and the
 *   message is reported so the driver knows that one didn't count;
 * - a network failure -> flushing stops, everything left stays queued for the
 *   next attempt.
 */
export interface FlushResult {
  sent: number;
  rejected: Array<{ item: QueuedPayment; reason: string }>;
  remaining: number;
}

export async function enqueuePayment(item: QueuedPayment): Promise<number> {
  const queue = await getQueue();
  queue.push(item);
  await setQueue(queue);
  return queue.length;
}

let flushing = false;

export async function flushQueue(): Promise<FlushResult> {
  // Re-entrancy guard: NetInfo events and manual refreshes can overlap.
  if (flushing) {
    const queue = await getQueue();
    return { sent: 0, rejected: [], remaining: queue.length };
  }
  flushing = true;
  try {
    const queue = await getQueue();
    const rejected: FlushResult['rejected'] = [];
    let sent = 0;

    while (queue.length > 0) {
      const item = queue[0];
      try {
        await apiFetch<Payment>('/payments', {
          method: 'POST',
          body: JSON.stringify({
            dailyAssignmentId: item.dailyAssignmentId,
            driverId: item.driverId,
            amount: item.amount,
            ...(item.paymentMethod ? { paymentMethod: item.paymentMethod } : {}),
          }),
        });
        sent += 1;
        queue.shift();
        await setQueue(queue);
      } catch (error) {
        if (error instanceof NetworkError) {
          break; // still offline - keep the rest for later
        }
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          rejected.push({ item, reason: error.message });
          queue.shift();
          await setQueue(queue);
          continue;
        }
        break; // unknown/server error - retry later rather than dropping money records
      }
    }

    return { sent, rejected, remaining: queue.length };
  } finally {
    flushing = false;
  }
}
