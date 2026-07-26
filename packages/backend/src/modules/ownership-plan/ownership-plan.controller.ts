import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OwnershipPlanService } from './ownership-plan.service';
import { CreateOwnershipPlanDto } from './dto/create-ownership-plan.dto';
import { UpdateOwnershipPlanDto } from './dto/update-ownership-plan.dto';

// No DELETE - cancelling is status = CANCELLED. A plan with payments against
// it must never vanish.
@Controller('ownership-plans')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OwnershipPlanController {
  constructor(private readonly ownershipPlanService: OwnershipPlanService) {}

  @Post()
  @Roles(UserRole.OWNER)
  create(@Body() dto: CreateOwnershipPlanDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.ownershipPlanService.create(dto, actor);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.ownershipPlanService.list(actor);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.RIDER)
  get(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.ownershipPlanService.get(id, actor);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOwnershipPlanDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ownershipPlanService.update(id, dto, actor);
  }
}
