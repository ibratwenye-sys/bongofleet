import { Module } from '@nestjs/common';
import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [TransportController],
  providers: [TransportService, RolesGuard],
})
export class TransportModule {}
