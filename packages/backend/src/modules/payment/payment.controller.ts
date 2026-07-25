import { createReadStream } from 'node:fs';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaymentService, MAX_RECEIPT_SIZE_BYTES, receiptFileFilter } from './payment.service';
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

  @Post(':id/receipt')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.RIDER)
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
    return this.paymentService.uploadReceipt(id, file, actor);
  }

  @Get(':id/receipt')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.RIDER)
  async downloadReceipt(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { payment, absolutePath } = await this.paymentService.getReceiptFile(id, actor);
    res.set({
      'Content-Type': payment.receiptMimeType ?? 'application/octet-stream',
      'Content-Disposition': `inline; filename="${payment.receiptFileName ?? 'receipt'}"`,
    });
    return new StreamableFile(createReadStream(absolutePath));
  }
}
