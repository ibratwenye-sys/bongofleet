import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [PaymentController],
  providers: [PaymentService, RolesGuard],
  // Stage G10 - OwnershipPlanService reuses PaymentService's own tested
  // createPayment cascade to allocate an APPLIED deposit at plan creation,
  // rather than writing a DailyPayment row directly.
  exports: [PaymentService],
})
export class PaymentModule {}
