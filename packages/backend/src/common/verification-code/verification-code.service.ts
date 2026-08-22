import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { hashPassword, comparePassword } from '../../modules/auth/utils/password.util';

export interface VerificationCodeConfig {
  length: number;
  ttlSeconds: number;
}

/**
 * Stage S1. The core of every "prove you received a short code" flow in the
 * app - Stage H0f's password reset and Stage S1's signup verification both
 * funnel through this (see password-reset.service.ts and
 * signup-verification.service.ts), so the guarantees - bcrypt-hashed at
 * rest, single use, attempt-budgeted, TTL-expiring - exist in exactly one
 * place and cannot drift between the two callers. Each caller owns its own
 * key format and its own length/TTL/attempt numbers (they are free to move
 * independently - see env.validation.ts's note on TENANT_TRIAL_DAYS vs
 * ABANDONED_SIGNUP_RETENTION_DAYS for why that separation matters); only the
 * mechanics are shared.
 */
@Injectable()
export class VerificationCodeService {
  constructor(private readonly redis: RedisService) {}

  /** randomInt, not Math.random: this is a credential for the length of its
   *  life, and Math.random is predictable from prior outputs. Padded rather
   *  than assembled digit by digit so every value in the range is equally
   *  likely, leading zeroes included. */
  private generate(length: number): string {
    const max = 10 ** length;
    return String(randomInt(0, max)).padStart(length, '0');
  }

  /** Issues a fresh code under `key`, replacing any code already there.
   *  Returns the plaintext code - store it nowhere; the caller's only job is
   *  to deliver it once and never persist it itself. */
  async issue(key: string, config: VerificationCodeConfig): Promise<string> {
    const code = this.generate(config.length);
    const codeHash = await hashPassword(code);

    await this.redis
      .multi()
      .del(key)
      .hset(key, { hash: codeHash, attempts: '0' })
      .expire(key, config.ttlSeconds)
      .exec();

    return code;
  }

  /**
   * Consumes an attempt against `key`. Returns true and deletes the key only
   * on a correct, still-live code - single use. A wrong guess counts against
   * the attempt budget and destroys the code outright once it is spent: the
   * CODE dies, not whatever it was protecting (see RESET_CODE_MAX_ATTEMPTS's
   * original reasoning in password-reset.constants.ts, generalized here).
   */
  async verify(key: string, code: string, maxAttempts: number): Promise<boolean> {
    const stored = await this.redis.hgetall(key);
    if (!stored?.hash) {
      return false;
    }

    const attempts = Number(stored.attempts ?? '0');
    if (attempts >= maxAttempts) {
      await this.redis.del(key);
      return false;
    }

    if (!(await comparePassword(code, stored.hash))) {
      const next = await this.redis.hincrby(key, 'attempts', 1);
      if (next >= maxAttempts) {
        await this.redis.del(key);
      }
      return false;
    }

    await this.redis.del(key);
    return true;
  }
}
