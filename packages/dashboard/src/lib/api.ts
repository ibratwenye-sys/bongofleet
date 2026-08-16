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
  // FormData bodies (file uploads) must NOT get an explicit Content-Type - the
  // browser sets 'multipart/form-data; boundary=...' itself, and overriding it
  // here would drop the boundary and break multer's parsing server-side.
  const headers: Record<string, string> = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return fetch(`${BASE_URL}${path}`, { ...options, headers });
}

/**
 * Stage H0e - refresh is single-flight. Refresh tokens are single-use and
 * rotate server-side (auth.service.ts deletes the stored hash and issues a
 * new pair), so two concurrent refreshes with the same token are not merely
 * wasteful: the first rotates it and every other one is rejected as "already
 * used", takes the !res.ok path below, and drags the caller into
 * tokenStore.clear() + a redirect to /login.
 *
 * That is easy to hit and has nothing to do with the token being expired.
 * The access token is memory-only, so on any fresh page load it starts
 * empty; a page that fetches several resources at once (Ownership asks for
 * plans, drivers and motorcycles in one Promise.all) fires them all with no
 * Authorization header, gets three 401s, and calls this three times over.
 * Whether that beat the bootstrap refresh in auth-context was pure timing -
 * on localhost it usually lost, which is why this only ever surfaced on the
 * slower CI runner. On a phone on mobile data it would surface as being
 * thrown back to the login screen at random while the dashboard loads.
 *
 * Sharing one in-flight promise means concurrent callers all wait on the
 * same request and then retry with the token it produced. The rotation and
 * the rate limit both stay exactly as they are; this stops abusing them.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
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

export function refreshTokens(): Promise<boolean> {
  if (!refreshInFlight) {
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

export async function apiFetchBlob(path: string, isRetry = false): Promise<Blob> {
  const res = await rawFetch(path);

  if (res.status === 401 && !isRetry) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      return apiFetchBlob(path, true);
    }
    tokenStore.clear();
    window.location.assign('/login');
    throw new ApiError(401, 'Session expired');
  }

  if (!res.ok) {
    throw new ApiError(res.status, `Request failed: ${res.status}`);
  }

  return res.blob();
}
