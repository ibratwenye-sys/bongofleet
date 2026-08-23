import { Global, Module } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import KeyvRedis from '@keyv/redis';
import { TenantCacheService } from './tenant-cache.service';

// Off the SAME REDIS_URL every other Redis-backed piece of this app already
// uses (RedisService, ThrottlerRedisService) - not a second Redis
// deployment or a second env var to keep in sync, just a second CLIENT
// connected to the one Redis instance, because @keyv/redis speaks the
// `redis` package's protocol and RedisService is built on ioredis; the two
// libraries cannot literally share a socket. A namespace is set explicitly
// (rather than trusting Keyv's own default) so this module's Redis keys are
// self-evidently its own, not an implementation detail to reverse-engineer.
@Global()
@Module({
  imports: [
    NestCacheModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        stores: [
          new KeyvRedis(config.get<string>('REDIS_URL') as string, {
            namespace: 'bongofleet-cache',
          }),
        ],
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [TenantCacheService],
  // Only TenantCacheService is exported, deliberately not the raw
  // CACHE_MANAGER token from NestCacheModule - nothing in this app should be
  // able to reach the cache except through the tenant-scoped wrapper below.
  exports: [TenantCacheService],
})
export class CacheModule {}
