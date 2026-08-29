import { Module } from '@nestjs/common';
import { DriverController } from './driver.controller';
import { DriverService } from './driver.service';
import { DriverScoreService } from './driver-score';
import { DriverScoreboardService } from './driver-scoreboard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthModule } from '../auth/auth.module';

@Module({
  // Stage H0f - for PasswordResetService, so PATCH :id/password goes through
  // the same reset core as the self-service flow rather than growing its own
  // copy of "hash it, revoke sessions, write an audit row".
  imports: [AuthModule],
  controllers: [DriverController],
  providers: [DriverService, DriverScoreService, DriverScoreboardService, RolesGuard],
})
export class DriverModule {}
