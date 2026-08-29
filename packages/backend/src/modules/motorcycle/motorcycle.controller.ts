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
import { MotorcycleService } from './motorcycle.service';
import { FleetSummaryService } from './fleet-summary.service';
import { CreateMotorcycleDto } from './dto/create-motorcycle.dto';
import { UpdateMotorcycleDto } from './dto/update-motorcycle.dto';
import { ListMotorcyclesQueryDto } from './dto/list-motorcycles-query.dto';

@ApiTags('motorcycle')
@ApiBearerAuth()
@Controller('motorcycles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class MotorcycleController {
  constructor(
    private readonly motorcycleService: MotorcycleService,
    private readonly fleetSummaryService: FleetSummaryService,
  ) {}

  @Post()
  create(@Body() dto: CreateMotorcycleDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.motorcycleService.create(dto, actor);
  }

  @Get()
  list(@Query() query: ListMotorcyclesQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.motorcycleService.list(query, actor);
  }

  // Must stay ahead of `:id` below - same reasoning as every other
  // fixed-segment route in this codebase (see driver.controller.ts's
  // "search"/"scoreboard").
  @Get('fleet-summary')
  fleetSummary(@CurrentUser() actor: AuthenticatedUser) {
    return this.fleetSummaryService.getSummary(actor);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.motorcycleService.get(id, actor);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMotorcycleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.motorcycleService.update(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.motorcycleService.deactivate(id, actor);
  }

  @Patch(':id/reactivate')
  reactivate(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.motorcycleService.reactivate(id, actor);
  }
}
