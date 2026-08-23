import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { CacheModule } from './cache/cache.module';
import { ThrottlerRedisService } from './redis/throttler-redis.service';
import { buildThrottlerOptions } from './common/throttle/throttler-options.factory';
import { AuthModule } from './modules/auth/auth.module';
import { PaymentModule } from './modules/payment/payment.module';
import { AssignmentModule } from './modules/assignment/assignment.module';
import { MotorcycleModule } from './modules/motorcycle/motorcycle.module';
import { DriverModule } from './modules/driver/driver.module';
import { DocumentModule } from './modules/document/document.module';
import { GuarantorModule } from './modules/guarantor/guarantor.module';
import { NotificationModule } from './modules/notification/notification.module';
import { ExpenseModule } from './modules/expense/expense.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { TransportModule } from './modules/transport/transport.module';
import { OwnershipPlanModule } from './modules/ownership-plan/ownership-plan.module';
import { PaymentAccountModule } from './modules/payment-account/payment-account.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { envValidationSchema } from './config/env.validation';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
      validationSchema: envValidationSchema,
    }),
    // Stage H0 - Redis-backed (Part 4), tracked by user-or-IP globally (Part
    // 1) and by dedicated per-route throttlers for login/signup/refresh
    // (Parts 2/3/5). See throttler-options.factory.ts for the full wiring
    // and throttle.constants.ts for the numbers, with rationale, in one
    // place.
    ThrottlerModule.forRootAsync({
      imports: [RedisModule, JwtModule.register({})],
      inject: [ThrottlerRedisService, ConfigService, JwtService],
      useFactory: (redis: ThrottlerRedisService, config: ConfigService, jwt: JwtService) =>
        buildThrottlerOptions(new ThrottlerStorageRedisService(redis), config, jwt),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    CacheModule,
    AuthModule,
    PaymentModule,
    AssignmentModule,
    MotorcycleModule,
    DriverModule,
    DocumentModule,
    GuarantorModule,
    NotificationModule,
    ExpenseModule,
    AnalyticsModule,
    MaintenanceModule,
    TransportModule,
    OwnershipPlanModule,
    PaymentAccountModule,
    TenantModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
  ],
})
export class AppModule {}
