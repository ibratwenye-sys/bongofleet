import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantService } from './tenant.service';

// Stage SUB1 - a sibling of TenantController rather than a route added to
// it: that controller is mounted at 'tenant/settings', and billing is a
// distinct resource ('tenant/billing'), not a settings field. Kept in the
// tenant module regardless, since both are tenant-scoped reads about the
// tenant's own account.
@ApiTags('tenant')
@ApiBearerAuth()
@Controller('tenant/billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER)
export class TenantBillingController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  getBilling(@CurrentUser() actor: AuthenticatedUser) {
    return this.tenantService.getBilling(actor);
  }
}
