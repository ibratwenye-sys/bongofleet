import { Module } from '@nestjs/common';
import { GpsController } from './gps.controller';
import { GpsService } from './gps.service';
import { GpsDevicePollingService } from './gps-device-polling.service';
import { TraccarClient } from './traccar-client';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [GpsController],
  providers: [GpsService, GpsDevicePollingService, TraccarClient, RolesGuard],
})
export class GpsModule {}
