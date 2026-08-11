import { Module } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [TenantController],
  providers: [TenantService, RolesGuard],
})
export class TenantModule {}
