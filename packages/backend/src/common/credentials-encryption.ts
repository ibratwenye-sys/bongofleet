import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * Stage 1b (DESIGN_GPS_TRACKING.md §5) - the first encryption-at-rest
 * utility in this codebase. PaymentGatewayConfig (DESIGN_PAYMENT_COLLECTION.md)
 * doesn't exist yet - Stage J is still blocked on AzamPay - so there was no
 * existing pattern to copy; this is built so that stage can reuse it rather
 * than inventing its own.
 *
 * AES-256-GCM via Node's built-in crypto module, no new dependency.
 *
 * Encoded Buffer layout (what encryptCredentials returns and
 * decryptCredentials expects): 12-byte random IV || 16-byte GCM auth tag ||
 * ciphertext, concatenated. The IV is random per call (never reused with the
 * same key - GCM's one hard rule); the auth tag is GCM's own integrity
 * check, verified on decrypt via setAuthTag before the ciphertext is
 * touched, so any tampering (or corruption) throws instead of silently
 * yielding garbage plaintext.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Deliberately NOT read at module load. Every other env-var consumer in
 * this codebase reads via ConfigService (populated once ConfigModule.forRoot
 * runs dotenv.config() during ordinary Nest bootstrap), never raw
 * process.env at a module's top level - and there's a concrete reason: this
 * file has no NestJS DI of its own (by design - Stage J needs to reuse it
 * as plain functions, not a service), and Node resolves every static
 * `import` in AppModule's transitive graph - which is where a
 * GpsProviderConfigService importing this file would sit - BEFORE
 * app.module.ts's own @Module({...}) decorator body (which is what calls
 * ConfigModule.forRoot()) ever executes. A top-level `const KEY =
 * loadKey()` here would therefore read process.env before dotenv has
 * populated it from the .env file, and fail this dev/test setup every time
 * even with a correctly-configured key.
 *
 * So the key is loaded and validated lazily, on first actual use, and
 * cached after that - by the time any real request or cron tick calls
 * encryptCredentials/decryptCredentials, Nest bootstrap (and therefore
 * dotenv) has always already completed. This still satisfies "fail loudly,
 * never a silent default": the very first attempt to use this utility
 * throws immediately and clearly if the key is missing or malformed, it
 * just isn't literally the moment this file is `import`ed.
 */
let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) {
    return cachedKey;
  }

  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY is not set. It must be a base64-encoded 32-byte key - ' +
        "generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `CREDENTIALS_ENCRYPTION_KEY must decode (base64) to exactly ${KEY_LENGTH} bytes, ` +
        `got ${key.length}. Generate a valid one with: ` +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  cachedKey = key;
  return key;
}

export function encryptCredentials(plaintext: string): Buffer {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decryptCredentials(buf: Buffer): string {
  const key = loadKey();
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
