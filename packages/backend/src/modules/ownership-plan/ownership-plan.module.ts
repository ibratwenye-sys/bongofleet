import { Module } from '@nestjs/common';
import { OwnershipPlanController } from './ownership-plan.controller';
import { OwnershipPlanService } from './ownership-plan.service';
import { OwnershipPlanGeneratorService } from './ownership-plan-generator.service';
import { OwnershipPlanContractService } from './ownership-plan-contract.service';
import { OwnershipPlanExcusalService } from './ownership-plan-excusal.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DocumentModule } from '../document/document.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [DocumentModule, PaymentModule],
  controllers: [OwnershipPlanController],
  providers: [
    OwnershipPlanService,
    OwnershipPlanGeneratorService,
    OwnershipPlanContractService,
    OwnershipPlanExcusalService,
    RolesGuard,
  ],
})
export class OwnershipPlanModule {}
