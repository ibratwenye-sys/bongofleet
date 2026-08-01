import { Module } from '@nestjs/common';
import { PaymentAccountController } from './payment-account.controller';
import { PaymentAccountService } from './payment-account.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [PaymentAccountController],
  providers: [PaymentAccountService, RolesGuard],
  exports: [PaymentAccountService],
})
export class PaymentAccountModule {}
