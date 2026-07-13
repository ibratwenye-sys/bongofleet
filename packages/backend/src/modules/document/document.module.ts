import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [DocumentController],
  providers: [DocumentService, RolesGuard],
})
export class DocumentModule {}
