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
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ExpenseService, MAX_RECEIPT_SIZE_BYTES, receiptFileFilter } from './expense.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';
import { SubmitExpenseDto } from './dto/submit-expense.dto';
import { RejectExpenseDto } from './dto/reject-expense.dto';

@ApiTags('expense')
@ApiBearerAuth()
@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class ExpenseController {
  constructor(private readonly expenseService: ExpenseService) {}

  @Post()
  create(@Body() dto: CreateExpenseDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.expenseService.create(dto, actor);
  }

  // Stage H2 - the three RIDER-facing literal-segment routes below
  // (submissions, mine, pending-count) must be declared before @Get(':id')/
  // @Patch(':id') further down: Nest matches routes in declaration order,
  // and a bare :id route registered first would swallow "mine" or
  // "pending-count" as an id value. Verified against the actual generated
  // route table (RouterExplorer's startup log), not assumed.
  @Post('submissions')
  @Roles(UserRole.RIDER)
  submit(@Body() dto: SubmitExpenseDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.expenseService.submit(dto, actor);
  }

  @Get('mine')
  @Roles(UserRole.RIDER)
  mine(@CurrentUser() actor: AuthenticatedUser) {
    return this.expenseService.listMine(actor);
  }

  @Get('pending-count')
  pendingCount(@CurrentUser() actor: AuthenticatedUser) {
    return this.expenseService.pendingCount(actor);
  }

  @Get()
  list(@Query() query: ListExpensesQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.expenseService.list(query, actor);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.expenseService.get(id, actor);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.expenseService.update(id, dto, actor);
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.expenseService.approve(id, actor);
  }

  @Patch(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectExpenseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.expenseService.reject(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.expenseService.remove(id, actor);
  }

  @Post(':id/receipt')
  @Roles(UserRole.RIDER)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_RECEIPT_SIZE_BYTES },
      fileFilter: receiptFileFilter,
    }),
  )
  uploadReceipt(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('A receipt file is required');
    }
    return this.expenseService.uploadReceipt(id, file, actor);
  }
}
