import { randomBytes } from 'node:crypto';

/**
 * Stage I2 (DESIGN_GPS_TRACKING.md §8). The unauthenticated public tracking
 * URL's only credential - unlike generateRideReference() (short, human-typed,
 * uniqueness-only), this token IS the security boundary on
 * TrackingLinkPublicController: there is no login, no @Roles, nothing else
 * standing between a stranger with this string and the position data it
 * unlocks. 32 bytes of CSPRNG output, base64url-encoded (~43 chars, URL-safe,
 * no padding) makes guessing infeasible; uniqueness is still enforced by the
 * DB's unique constraint on the column, with the caller retrying on the
 * (astronomically rare) collision - same pattern as generateRideReference().
 */
export function generateTrackingToken(): string {
  return randomBytes(32).toString('base64url');
}
