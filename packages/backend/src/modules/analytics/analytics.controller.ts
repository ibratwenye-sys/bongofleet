import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AnalyticsService } from './analytics.service';
import { ReportRangeQueryDto } from './dto/report-range-query.dto';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('pnl')
  summary(@Query() query: ReportRangeQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.analyticsService.getSummary(query, actor);
  }

  @Get('per-motorcycle')
  perMotorcycle(@Query() query: ReportRangeQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.analyticsService.getPerMotorcycle(query, actor);
  }

  @Get('per-rider')
  perRider(@Query() query: ReportRangeQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.analyticsService.getPerRider(query, actor);
  }

  @Get('expense-breakdown')
  expenseBreakdown(@Query() query: ReportRangeQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.analyticsService.getExpenseBreakdown(query, actor);
  }
}
