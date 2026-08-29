import { Module } from '@nestjs/common';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceSummaryService } from './maintenance-summary.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [MaintenanceController],
  providers: [MaintenanceService, MaintenanceSummaryService, RolesGuard],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
