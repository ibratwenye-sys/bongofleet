import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceSummaryService } from './maintenance-summary.service';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto';
import { ListMaintenanceQueryDto } from './dto/list-maintenance-query.dto';

@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class MaintenanceController {
  constructor(
    private readonly maintenanceService: MaintenanceService,
    private readonly maintenanceSummaryService: MaintenanceSummaryService,
  ) {}

  @Post()
  create(@Body() dto: CreateMaintenanceDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.maintenanceService.create(dto, actor);
  }

  @Get()
  list(@Query() query: ListMaintenanceQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.maintenanceService.list(query, actor);
  }

  // Must stay ahead of `:id` below - same reasoning as every other
  // fixed-segment route in this codebase.
  @Get('summary')
  summary(@CurrentUser() actor: AuthenticatedUser) {
    return this.maintenanceSummaryService.getSummary(actor);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.maintenanceService.get(id, actor);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMaintenanceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.maintenanceService.update(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.maintenanceService.remove(id, actor);
  }
}
