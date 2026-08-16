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
    // Multipart (receipt upload) must NOT get an explicit Content-Type - the
    // runtime sets 'multipart/form-data; boundary=...' itself.
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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

/**
 * Refresh tokens are single-use and rotate: the server deletes the stored
 * hash and issues a new pair, so replaying one is rejected as "already
 * used". Two things follow, and this file needs both of them.
 *
 * First, concurrent refreshes must not happen. HomeScreen loads /auth/me,
 * /assignments and /payments together, and a reconnect can fire flushQueue
 * alongside that reload; once the access token has aged out, every one of
 * those gets a 401 at the same moment and each would refresh with the same
 * token. One wins and the rest are rejected - not because the session ended,
 * but because they raced. The in-flight promise below collapses them into
 * one request that they all await.
 *
 * Second - and this is the part single-flight cannot do - a rejection has to
 * be interpreted rather than obeyed. "Already used" and "invalid" are both
 * 401, and they mean opposite things: the first says another refresh just
 * succeeded and the session is alive, the second says it is over. Single
 * flight only covers calls made inside one process at one moment; it does
 * nothing for an app backgrounded mid-refresh, two screens mounting, or any
 * retry path added later. So on a 401 the stored token is re-read: if it has
 * changed underneath us, someone else's refresh already replaced it and the
 * right answer is to carry on with the new pair, not to log the rider out.
 *
 * That distinction is what makes this failure survivable instead of
 * destructive. Riders are on mobile data by definition - the latency profile
 * where these requests overlap - and being wrongly logged out mid-shift
 * strands whatever is still sitting in the offline payment queue.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  const usedToken = await getRefreshToken();
  if (!usedToken) return false;

  // rawFetch throws NetworkError when the device cannot reach the server.
  // That propagates out of here deliberately: apiFetch turns it into a
  // NetworkError for the caller and keeps the session, so offline work can
  // queue. Every waiter on this shared promise receives that same rejection,
  // which is exactly right - none of them should log out either.
  const res = await rawFetch('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken: usedToken }),
  });

  if (res.status === 401) {
    const currentToken = await getRefreshToken();
    if (currentToken && currentToken !== usedToken) {
      // Another refresh rotated the pair while this one was in flight, so
      // this 401 means "already used", not "session over". saveTokens writes
      // both halves together, so a changed refresh token means a fresh
      // access token is stored too - the caller's retry will pick it up.
      // Deliberately not re-posting with currentToken: that pair is seconds
      // old, and spending it again would rotate it for nothing and hand the
      // same stale-token problem to whoever holds it next.
      return true;
    }
    return false;
  }

  if (!res.ok) return false;

  const tokens = (await res.json()) as TokenResponse;
  await saveTokens(tokens);
  return true;
}

function refreshTokens(): Promise<boolean> {
  if (!refreshInFlight) {
    // Cleared in .finally() rather than after a success, so a rejected
    // attempt is never cached for later callers to await forever.
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
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
      // callers can queue the work instead of logging the driver out.
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
