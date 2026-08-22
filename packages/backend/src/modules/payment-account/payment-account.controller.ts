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
import { PaymentAccountService } from './payment-account.service';
import { CreatePaymentAccountDto } from './dto/create-payment-account.dto';
import { UpdatePaymentAccountDto } from './dto/update-payment-account.dto';
import { ListPaymentAccountsQueryDto } from './dto/list-payment-accounts-query.dto';

@ApiTags('payment-account')
@ApiBearerAuth()
@Controller('payment-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class PaymentAccountController {
  constructor(private readonly paymentAccountService: PaymentAccountService) {}

  @Post()
  create(@Body() dto: CreatePaymentAccountDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.paymentAccountService.create(dto, actor);
  }

  @Get()
  list(@Query() query: ListPaymentAccountsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.paymentAccountService.list(query, actor);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentAccountDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paymentAccountService.update(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.paymentAccountService.remove(id, actor);
  }
}
