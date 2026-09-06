import { Module } from '@nestjs/common';
import { TransportReconciliationController } from './transport-reconciliation.controller';
import { TransportReconciliationService } from './transport-reconciliation.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [TransportReconciliationController],
  providers: [TransportReconciliationService, RolesGuard],
})
export class TransportReconciliationModule {}
