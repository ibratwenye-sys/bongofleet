import { Module } from '@nestjs/common';
import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';
import { TransportOperationsService } from './transport-operations.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [AnalyticsModule],
  controllers: [TransportController],
  providers: [TransportService, TransportOperationsService, RolesGuard],
})
export class TransportModule {}
