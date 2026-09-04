import { createReadStream } from 'node:fs';
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
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ExpenseService, MAX_RECEIPT_SIZE_BYTES, receiptFileFilter } from './expense.service';
import { ExpenseSummaryService } from './expense-summary.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';
import { SubmitExpenseDto } from './dto/submit-expense.dto';
import { RejectExpenseDto } from './dto/reject-expense.dto';
import { ReportRangeQueryDto } from '../analytics/dto/report-range-query.dto';

@ApiTags('expense')
@ApiBearerAuth()
@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class ExpenseController {
  constructor(
    private readonly expenseService: ExpenseService,
    private readonly expenseSummaryService: ExpenseSummaryService,
  ) {}

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

  // Stage DM16 - the truck/car-driver-mode counterpart: same body shape,
  // resolved against the caller's current TransportJob instead of a
  // DailyAssignment. Same fixed-segment-before-:id routing-order reason as
  // submissions/mine/pending-count above.
  @Post('job-submissions')
  @Roles(UserRole.RIDER)
  submitForJob(@Body() dto: SubmitExpenseDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.expenseService.submitForJob(dto, actor);
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

  @Get('summary')
  summary(@CurrentUser() actor: AuthenticatedUser) {
    return this.expenseSummaryService.getKpis(actor);
  }

  @Get('cost-per-vehicle-type')
  costPerVehicleType(@Query() query: ReportRangeQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.expenseSummaryService.getCostPerVehicleByType(query, actor);
  }

  @Get('anomalies')
  anomalies(@CurrentUser() actor: AuthenticatedUser) {
    return this.expenseSummaryService.getVehicleAnomalies(actor);
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

  @Get(':id/receipt')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.RIDER)
  async downloadReceipt(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { expense, absolutePath } = await this.expenseService.getReceiptFile(id, actor);
    res.set({
      'Content-Type': expense.receiptMimeType ?? 'application/octet-stream',
      'Content-Disposition': `inline; filename="${expense.receiptFileName ?? 'receipt'}"`,
    });
    return new StreamableFile(createReadStream(absolutePath));
  }
}
