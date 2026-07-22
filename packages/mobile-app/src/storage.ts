import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueuedPayment, TokenResponse } from './types';

const ACCESS_KEY = 'bf.accessToken';
const REFRESH_KEY = 'bf.refreshToken';
const QUEUE_KEY = 'bf.paymentQueue';

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
