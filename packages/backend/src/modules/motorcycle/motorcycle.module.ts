import { Module } from '@nestjs/common';
import { MotorcycleController } from './motorcycle.controller';
import { MotorcycleService } from './motorcycle.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [MotorcycleController],
  providers: [MotorcycleService, RolesGuard],
})
export class MotorcycleModule {}
