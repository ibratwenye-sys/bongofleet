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
import { TransportService } from './transport.service';
import { TransportOperationsService } from './transport-operations.service';
import { CreateTransportJobDto } from './dto/create-transport-job.dto';
import { UpdateTransportJobDto } from './dto/update-transport-job.dto';
import { UpdateTransportJobStatusDto } from './dto/update-transport-job-status.dto';
import { ListTransportJobsQueryDto } from './dto/list-transport-jobs-query.dto';

@ApiTags('transport')
@ApiBearerAuth()
@Controller('transport-jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class TransportController {
  constructor(
    private readonly transportService: TransportService,
    private readonly transportOperationsService: TransportOperationsService,
  ) {}

  @Post()
  create(@Body() dto: CreateTransportJobDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.transportService.createJob(dto, actor);
  }

  // Stage DM4 - the two RIDER-accessible routes, overriding the class-level
  // OWNER/MANAGER-only default (Reflector.getAllAndOverride: a handler-level
  // @Roles fully replaces the class-level one for that route, it doesn't
  // add to it - verified against roles.guard.ts before relying on it).
  // POST/PATCH/DELETE and /summary stay OWNER/MANAGER only - a driver does
  // not create, update, or delete transport jobs in this stage.
  @Get()
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.RIDER)
  list(@Query() query: ListTransportJobsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.transportService.listJobs(query, actor);
  }

  @Get('summary')
  summary(@Query() query: ListTransportJobsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.transportService.vehicleSummary(query, actor);
  }

  // Must stay ahead of `:id` below - same reasoning as every other
  // fixed-segment route in this codebase.
  @Get('operations-summary')
  operationsSummary(@CurrentUser() actor: AuthenticatedUser) {
    return this.transportOperationsService.getOperationsSummary(actor);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.RIDER)
  get(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.transportService.getJob(id, actor);
  }

  // Stage DM12 - the narrow RIDER-facing status transition, must stay ahead
  // of the plain PATCH :id below (same fixed-segment-first convention as
  // operations-summary above). OWNER/MANAGER pass this @Roles override too,
  // for consistency with the other RIDER-accessible routes, but they
  // already have the full PATCH :id below for status changes.
  @Patch(':id/status')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.RIDER)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTransportJobStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.transportService.updateOwnStatus(id, dto, actor);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTransportJobDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.transportService.updateJob(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.transportService.deleteJob(id, actor);
  }
}
