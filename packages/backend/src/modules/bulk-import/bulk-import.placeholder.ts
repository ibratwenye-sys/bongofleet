import { randomBytes } from 'node:crypto';

const SUFFIX_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomSuffix(length = 6): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += SUFFIX_ALPHABET[bytes[i] % SUFFIX_ALPHABET.length];
  }
  return out;
}

/**
 * Stage BI1 - Driver.licenseNumber is required and unique per tenant, but
 * the Drivers template has no license-number column (real fleet rosters
 * genuinely don't have one on file - see the import spec). A clearly-fake
 * placeholder, never a value that could pass for a real license number, so
 * the preview's warning ("needs a real license number filled in later") is
 * the only place an owner learns this was left unset.
 */
export function generatePlaceholderLicenseNumber(): string {
  return `IMPORT-PENDING-${randomSuffix()}`;
}

/**
 * Stage BI1 - User.email is required and unique per tenant, but a driver
 * imported from a paper roster usually has none. `.invalid` is an IANA
 * reserved TLD that will never resolve, so this can never collide with, or
 * be mistaken for, a real address.
 */
export function generatePlaceholderEmail(): string {
  return `import-pending-${randomSuffix(8).toLowerCase()}@bongofleet.invalid`;
}

/** A random password for an imported driver's required User row - never
 *  surfaced anywhere; the driver has no dashboard/app access from this
 *  stage's import (dashboard-only, per the spec) and can be issued a real
 *  password later through the normal reset flow if that ever changes. */
export function generatePlaceholderPassword(): string {
  return randomBytes(24).toString('base64url');
}
