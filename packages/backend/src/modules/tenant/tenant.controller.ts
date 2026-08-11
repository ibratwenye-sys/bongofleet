import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantService } from './tenant.service';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';

@Controller('tenant/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  getSettings(@CurrentUser() actor: AuthenticatedUser) {
    return this.tenantService.getSettings(actor);
  }

  @Patch()
  updateSettings(@Body() dto: UpdateTenantSettingsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.tenantService.updateSettings(dto, actor);
  }
}
