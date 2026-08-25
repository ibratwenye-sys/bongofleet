import { Module } from '@nestjs/common';
import { BulkImportController } from './bulk-import.controller';
import { BulkImportService } from './bulk-import.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [BulkImportController],
  providers: [BulkImportService, RolesGuard],
})
export class BulkImportModule {}
