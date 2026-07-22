import { API_URL } from './config';
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from './storage';
import type { TokenResponse } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Thrown when the device appears to be offline / the server is unreachable. */
export class NetworkError extends Error {
  constructor() {
    super('Network unreachable');
  }
}

/** Called by the client when the session can no longer be refreshed. */
let onSessionExpired: (() => void) | null = null;
export function setOnSessionExpired(handler: () => void): void {
  onSessionExpired = handler;
}

async function rawFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const accessToken = await getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  try {
    return await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    // fetch rejects on DNS/connection failures - the offline case.
    throw new NetworkError();
  }
}

async function refreshTokens(): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return false;

  const res = await rawFetch('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return false;

  const tokens = (await res.json()) as TokenResponse;
  await saveTokens(tokens);
  return true;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  isRetry = false,
): Promise<T> {
  const res = await rawFetch(path, options);

  if (res.status === 401 && !isRetry) {
    let refreshed = false;
    try {
      refreshed = await refreshTokens();
    } catch {
      // Refresh failed because we're offline - surface as a network error so
      // callers can queue the work instead of logging the rider out.
      throw new NetworkError();
    }
    if (refreshed) {
      return apiFetch<T>(path, options, true);
    }
    await clearTokens();
    onSessionExpired?.();
    throw new ApiError(401, 'Session expired - please log in again');
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const message = Array.isArray(body.message)
      ? body.message.join(', ')
      : (body.message ?? `Request failed: ${res.status}`);
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}
