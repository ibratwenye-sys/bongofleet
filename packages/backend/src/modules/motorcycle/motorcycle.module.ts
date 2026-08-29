import { Module } from '@nestjs/common';
import { MotorcycleController } from './motorcycle.controller';
import { MotorcycleService } from './motorcycle.service';
import { FleetSummaryService } from './fleet-summary.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [AnalyticsModule],
  controllers: [MotorcycleController],
  providers: [MotorcycleService, FleetSummaryService, RolesGuard],
})
export class MotorcycleModule {}
