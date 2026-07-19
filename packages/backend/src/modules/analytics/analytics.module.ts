import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, RolesGuard],
})
export class AnalyticsModule {}
