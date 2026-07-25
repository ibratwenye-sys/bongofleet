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
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TransportService } from './transport.service';
import { CreateTransportJobDto } from './dto/create-transport-job.dto';
import { UpdateTransportJobDto } from './dto/update-transport-job.dto';
import { ListTransportJobsQueryDto } from './dto/list-transport-jobs-query.dto';

@Controller('transport-jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class TransportController {
  constructor(private readonly transportService: TransportService) {}

  @Post()
  create(@Body() dto: CreateTransportJobDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.transportService.createJob(dto, actor);
  }

  @Get()
  list(@Query() query: ListTransportJobsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.transportService.listJobs(query, actor);
  }

  @Get('summary')
  summary(@Query() query: ListTransportJobsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.transportService.vehicleSummary(query, actor);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.transportService.getJob(id, actor);
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
