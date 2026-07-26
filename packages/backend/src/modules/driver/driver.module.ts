import { Module } from '@nestjs/common';
import { DriverController } from './driver.controller';
import { DriverService } from './driver.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [DriverController],
  providers: [DriverService, RolesGuard],
})
export class DriverModule {}
