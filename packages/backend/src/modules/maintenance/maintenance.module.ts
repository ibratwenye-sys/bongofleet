import { Module } from '@nestjs/common';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [MaintenanceController],
  providers: [MaintenanceService, RolesGuard],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
