import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AnalyticsService } from './analytics.service';
import { ReportRangeQueryDto } from './dto/report-range-query.dto';
import { CollectionSeriesQueryDto } from './dto/collection-series-query.dto';
import { MonthlyPnlSeriesQueryDto } from './dto/monthly-pnl-series-query.dto';

@ApiTags('analytics')
@ApiBearerAuth()
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

  @Get('per-driver')
  perDriver(@Query() query: ReportRangeQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.analyticsService.getPerDriver(query, actor);
  }

  @Get('expense-breakdown')
  expenseBreakdown(@Query() query: ReportRangeQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.analyticsService.getExpenseBreakdown(query, actor);
  }

  /** Stage UI3 - exposes the Operations Center's existing, already-tested
   *  14-day collection chart so the Payments page's closing row can reuse
   *  it over a caller-supplied range, rather than a second implementation. */
  @Get('collection-series')
  collectionSeries(
    @Query() query: CollectionSeriesQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.analyticsService.getDailyCollectionSeries(query.from, query.to, actor);
  }

  @Get('pnl-by-segment')
  pnlBySegment(@Query() query: ReportRangeQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.analyticsService.getPnlBySegment(query, actor);
  }

  @Get('monthly-pnl-series')
  monthlyPnlSeries(
    @Query() query: MonthlyPnlSeriesQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.analyticsService.getMonthlyPnlSeries(
      query.monthsBack ?? 6,
      { vehicleType: query.vehicleType },
      actor,
    );
  }
}
