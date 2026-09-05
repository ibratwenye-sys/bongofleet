import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ExpenseCategoryCapService } from './expense-category-cap.service';
import { UpsertExpenseCategoryCapsDto } from './dto/upsert-expense-category-caps.dto';

@ApiTags('expense-category-cap')
@ApiBearerAuth()
@Controller('expense-category-caps')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpenseCategoryCapController {
  constructor(private readonly service: ExpenseCategoryCapService) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.list(actor);
  }

  @Put()
  @Roles(UserRole.OWNER)
  upsert(@Body() dto: UpsertExpenseCategoryCapsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.upsert(dto, actor);
  }
}
