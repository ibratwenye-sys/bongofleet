import { Module } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { TenantBillingController } from './tenant-billing.controller';
import { TenantService } from './tenant.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [TenantController, TenantBillingController],
  providers: [TenantService, RolesGuard],
})
export class TenantModule {}
