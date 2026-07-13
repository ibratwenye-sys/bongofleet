import { Module } from '@nestjs/common';
import { GuarantorController } from './guarantor.controller';
import { GuarantorService } from './guarantor.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [GuarantorController],
  providers: [GuarantorService, RolesGuard],
})
export class GuarantorModule {}
