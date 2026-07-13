import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { AssignmentService } from './assignment.service';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { ListAssignmentsQueryDto } from './dto/list-assignments-query.dto';

@Controller('assignments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssignmentController {
  constructor(private readonly assignmentService: AssignmentService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  create(@Body() dto: CreateAssignmentDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignmentService.createAssignment(dto, actor);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.RIDER)
  list(@Query() query: ListAssignmentsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignmentService.listAssignments(query, actor);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.RIDER)
  get(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignmentService.getAssignment(id, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.assignmentService.deleteAssignment(id, actor);
  }

  @Get('date/:date')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.RIDER)
  getByDate(@Param('date') date: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignmentService.getAssignmentsByDate(date, actor);
  }
}
