import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaymentService } from './payment.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.RIDER)
  create(@Body() dto: CreatePaymentDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.paymentService.createPayment(dto, actor);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.RIDER)
  list(@Query() query: ListPaymentsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.paymentService.listPayments(query, actor);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.RIDER)
  get(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.paymentService.getPayment(id, actor);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paymentService.updatePaymentStatus(id, dto, actor);
  }

  @Get('assignment/:assignmentId')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.RIDER)
  getByAssignment(
    @Param('assignmentId') assignmentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paymentService.getPaymentsByAssignment(assignmentId, actor);
  }
}
