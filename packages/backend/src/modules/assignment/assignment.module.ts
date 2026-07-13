import { Module } from '@nestjs/common';
import { AssignmentController } from './assignment.controller';
import { AssignmentService } from './assignment.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [AssignmentController],
  providers: [AssignmentService, RolesGuard],
})
export class AssignmentModule {}
