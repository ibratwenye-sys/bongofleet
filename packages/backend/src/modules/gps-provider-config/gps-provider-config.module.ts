import { Module } from '@nestjs/common';
import { GpsProviderConfigController } from './gps-provider-config.controller';
import { GpsProviderConfigService } from './gps-provider-config.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [GpsProviderConfigController],
  providers: [GpsProviderConfigService, RolesGuard],
})
export class GpsProviderConfigModule {}
