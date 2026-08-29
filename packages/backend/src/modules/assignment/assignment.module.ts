import { Module } from '@nestjs/common';
import { AssignmentController } from './assignment.controller';
import { AssignmentService } from './assignment.service';
import { AssignmentSummaryService } from './assignment-summary.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [AssignmentController],
  providers: [AssignmentService, AssignmentSummaryService, RolesGuard],
})
export class AssignmentModule {}
