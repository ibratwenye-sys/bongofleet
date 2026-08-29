import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, RolesGuard],
  // Stage UI1 - DashboardModule reuses getSummary/getPerMotorcycle/
  // getDailyCollectionSeries directly rather than a second, parallel P&L
  // implementation for the Operations Center KPIs.
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
