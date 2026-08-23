import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PendingReceiptUpload, QueuedExpense, QueuedPayment, TokenResponse } from './types';

const ACCESS_KEY = 'bf.accessToken';
const REFRESH_KEY = 'bf.refreshToken';
const QUEUE_KEY = 'bf.paymentQueue';
// Stage H4 - separate keys, separate arrays. Not folded into QUEUE_KEY:
// expenseQueue.ts is its own module for the same reason (see its own
// comment), and sharing a key would couple the two queues' storage formats
// together for no benefit.
const EXPENSE_QUEUE_KEY = 'bf.expenseQueue';
const PENDING_RECEIPTS_KEY = 'bf.expensePendingReceipts';

export async function saveTokens(tokens: TokenResponse): Promise<void> {
  await AsyncStorage.multiSet([
    [ACCESS_KEY, tokens.accessToken],
    [REFRESH_KEY, tokens.refreshToken],
  ]);
}

export async function getAccessToken(): Promise<string | null> {
  return AsyncStorage.getItem(ACCESS_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return AsyncStorage.getItem(REFRESH_KEY);
}

export async function clearTokens(): Promise<void> {
  await AsyncStorage.multiRemove([ACCESS_KEY, REFRESH_KEY]);
}

export async function getQueue(): Promise<QueuedPayment[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as QueuedPayment[]) : [];
  } catch {
    return [];
  }
}

export async function setQueue(queue: QueuedPayment[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function getExpenseQueue(): Promise<QueuedExpense[]> {
  const raw = await AsyncStorage.getItem(EXPENSE_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as QueuedExpense[]) : [];
  } catch {
    return [];
  }
}

export async function setExpenseQueue(queue: QueuedExpense[]): Promise<void> {
  await AsyncStorage.setItem(EXPENSE_QUEUE_KEY, JSON.stringify(queue));
}

export async function getPendingReceipts(): Promise<PendingReceiptUpload[]> {
  const raw = await AsyncStorage.getItem(PENDING_RECEIPTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PendingReceiptUpload[]) : [];
  } catch {
    return [];
  }
}

export async function setPendingReceipts(list: PendingReceiptUpload[]): Promise<void> {
  await AsyncStorage.setItem(PENDING_RECEIPTS_KEY, JSON.stringify(list));
}
