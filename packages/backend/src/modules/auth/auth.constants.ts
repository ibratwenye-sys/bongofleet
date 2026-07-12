export const ACCESS_TOKEN_EXPIRES_IN = '15m';
export const REFRESH_TOKEN_EXPIRES_IN = '7d';
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export function refreshKey(userId: string, jti: string): string {
  return `refresh:${userId}:${jti}`;
}
