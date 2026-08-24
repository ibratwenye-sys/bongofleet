import { Module } from '@nestjs/common';
import { GpsController } from './gps.controller';
import { GpsService } from './gps.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [GpsController],
  providers: [GpsService, RolesGuard],
})
export class GpsModule {}
