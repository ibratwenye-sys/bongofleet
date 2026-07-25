import { randomBytes } from 'node:crypto';

// Crockford base32 alphabet, minus the ambiguous I, L, O, U — so a ride number
// read aloud or written on a bank slip is hard to mistype.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A short, human-readable, never-repeating ride reference, e.g. "BF-7K3M9QP2".
 * 8 base32 chars ≈ 1.1e12 possibilities; uniqueness is guaranteed by a DB unique
 * constraint on the column, with the caller retrying on the (astronomically
 * rare) collision.
 */
export function generateRideReference(): string {
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i += 1) {
    code += ALPHABET[bytes[i] & 31];
  }
  return `BF-${code}`;
}
