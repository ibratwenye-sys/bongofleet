import { Module } from '@nestjs/common';
import { OwnershipPlanController } from './ownership-plan.controller';
import { OwnershipPlanService } from './ownership-plan.service';
import { OwnershipPlanGeneratorService } from './ownership-plan-generator.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [OwnershipPlanController],
  providers: [OwnershipPlanService, OwnershipPlanGeneratorService, RolesGuard],
})
export class OwnershipPlanModule {}
