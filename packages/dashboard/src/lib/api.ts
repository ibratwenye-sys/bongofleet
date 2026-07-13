import { tokenStore } from './token-store';
import type { TokenResponse } from './types';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function rawFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const accessToken = tokenStore.getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return fetch(`${BASE_URL}${path}`, { ...options, headers });
}

async function refreshTokens(): Promise<boolean> {
  const refreshToken = tokenStore.getRefreshToken();
  if (!refreshToken) {
    return false;
  }

  const res = await rawFetch('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    return false;
  }

  const tokens = (await res.json()) as TokenResponse;
  tokenStore.setTokens(tokens);
  return true;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  isRetry = false,
): Promise<T> {
  const res = await rawFetch(path, options);

  if (res.status === 401 && !isRetry) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      return apiFetch<T>(path, options, true);
    }
    tokenStore.clear();
    window.location.assign('/login');
    throw new ApiError(401, 'Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string | string[] });
    // NestJS's default ValidationPipe returns `message` as an array of strings
    // (one per failed field) for 400s; ConflictException etc. return a plain
    // string. Normalize both into a single readable message.
    const message = Array.isArray(body.message)
      ? body.message.join(', ')
      : (body.message ?? `Request failed: ${res.status}`);
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}
