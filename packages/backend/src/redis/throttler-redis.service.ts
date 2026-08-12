import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Stage H0 Part 4 - the prefix every throttle counter lives under, computed
 * from NODE_ENV so an e2e test run (NODE_ENV=test, forced by
 * test/setup-e2e.ts before the app even boots) can never share a counter
 * with real dev/prod traffic on the same REDIS_URL, in either direction.
 * Exported so test/utils/prisma-test.util.ts can flush exactly this
 * namespace between tests without duplicating the string.
 */
export function throttleKeyPrefix(nodeEnv: string): string {
  return `throttle:${nodeEnv}:`;
}

/**
 * A connection dedicated to throttle counters, separate from RedisService
 * (which holds refresh tokens and whatever else the app needs Redis for).
 * Own keyPrefix, own lifecycle - never shares a keyspace with anything else
 * in this Redis, and quits cleanly on shutdown same as RedisService does.
 */
@Injectable()
export class ThrottlerRedisService extends Redis implements OnModuleDestroy {
  constructor(config: ConfigService) {
    const nodeEnv = config.get<string>('NODE_ENV', 'development');
    super(config.get<string>('REDIS_URL') as string, {
      keyPrefix: throttleKeyPrefix(nodeEnv),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit();
  }
}
