import { randomBytes } from 'node:crypto';

/**
 * jest.resetModules() + a fresh require() per test: the module under test
 * caches its parsed key in a module-level variable after first use (see its
 * own comment on why that caching is lazy, not at import time), so
 * re-importing is necessary for each test to see a clean slate - same
 * pattern test/utils/test-redis.spec.ts already uses for the same reason.
 */
describe('credentials-encryption', () => {
  const ORIGINAL_ENV = { ...process.env };
  const VALID_KEY = randomBytes(32).toString('base64');

  beforeEach(() => {
    jest.resetModules();
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function load(): typeof import('./credentials-encryption') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.resetModules() needs a fresh require(), not a cached static import
    return require('./credentials-encryption');
  }

  it('round-trips: decryptCredentials(encryptCredentials(x)) === x', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = VALID_KEY;
    const { encryptCredentials, decryptCredentials } = load();

    const plaintext = JSON.stringify({ token: 'a-real-looking-traccar-token-value' });
    const encrypted = encryptCredentials(plaintext);

    expect(Buffer.isBuffer(encrypted)).toBe(true);
    expect(decryptCredentials(encrypted)).toBe(plaintext);
  });

  it('a single flipped byte anywhere in the buffer makes decryptCredentials throw, never returning corrupted plaintext', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = VALID_KEY;
    const { encryptCredentials, decryptCredentials } = load();

    const encrypted = encryptCredentials('secret-value');
    // Covers the IV region, the IV/auth-tag boundary, the auth-tag region,
    // and the ciphertext region - tampering anywhere must be caught, not
    // just at one offset.
    const byteIndexesToFlip = [0, 11, 12, 27, 28, encrypted.length - 1];

    for (const byteIndex of byteIndexesToFlip) {
      const tampered = Buffer.from(encrypted);
      tampered[byteIndex] ^= 0xff;
      expect(() => decryptCredentials(tampered)).toThrow();
    }
  });

  it('throws loudly when CREDENTIALS_ENCRYPTION_KEY is not set at all', () => {
    const { encryptCredentials } = load();
    expect(() => encryptCredentials('x')).toThrow(/CREDENTIALS_ENCRYPTION_KEY is not set/);
  });

  it('throws loudly when CREDENTIALS_ENCRYPTION_KEY does not decode to exactly 32 bytes', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64');
    const { encryptCredentials } = load();
    expect(() => encryptCredentials('x')).toThrow(/exactly 32 bytes/);
  });
});
