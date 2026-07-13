import { Module } from '@nestjs/common';
import { RiderController } from './rider.controller';
import { RiderService } from './rider.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [RiderController],
  providers: [RiderService, RolesGuard],
})
export class RiderModule {}
