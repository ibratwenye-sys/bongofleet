import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [PaymentController],
  providers: [PaymentService, RolesGuard],
})
export class PaymentModule {}
