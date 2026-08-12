import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { ThrottlerRedisService } from './throttler-redis.service';

@Global()
@Module({
  providers: [RedisService, ThrottlerRedisService],
  exports: [RedisService, ThrottlerRedisService],
})
export class RedisModule {}
