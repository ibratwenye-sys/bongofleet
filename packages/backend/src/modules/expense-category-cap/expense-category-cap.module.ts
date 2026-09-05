import { Module } from '@nestjs/common';
import { ExpenseCategoryCapController } from './expense-category-cap.controller';
import { ExpenseCategoryCapService } from './expense-category-cap.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [ExpenseCategoryCapController],
  providers: [ExpenseCategoryCapService, RolesGuard],
})
export class ExpenseCategoryCapModule {}
