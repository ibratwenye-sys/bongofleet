import { Module } from '@nestjs/common';
import { ExpenseController } from './expense.controller';
import { ExpenseService } from './expense.service';
import { ExpenseSummaryService } from './expense-summary.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [AnalyticsModule],
  controllers: [ExpenseController],
  providers: [ExpenseService, ExpenseSummaryService, RolesGuard],
  exports: [ExpenseService],
})
export class ExpenseModule {}
