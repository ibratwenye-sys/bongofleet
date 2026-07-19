import { Module } from '@nestjs/common';
import { ExpenseController } from './expense.controller';
import { ExpenseService } from './expense.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [ExpenseController],
  providers: [ExpenseService, RolesGuard],
  exports: [ExpenseService],
})
export class ExpenseModule {}
