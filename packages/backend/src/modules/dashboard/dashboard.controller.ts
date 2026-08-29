import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

/** Stage UI1 - the Operations Center page's single data source, OWNER or
 *  MANAGER (same gate as everything else an owner's day-to-day staff can
 *  see - fleet positions, assignments, payments), tenant-scoped as usual
 *  via the Prisma extension. Gated the same way as every other controller
 *  (RolesGuard + @Roles), not just DashboardService's own internal check -
 *  see AnalyticsController for the identical pattern. */
@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('operations-center')
  getOperationsCenter(@CurrentUser() actor: AuthenticatedUser) {
    return this.dashboardService.getOperationsCenter(actor);
  }
}
