import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
    // Stage H0f - reuses the MailerService that already sends document
    // expiry and missed-payment alerts, rather than introducing a second
    // way to send mail. Log-only when SMTP_HOST is unset, same as those.
    NotificationModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordResetService, JwtStrategy, JwtAuthGuard],
  exports: [AuthService, PasswordResetService],
})
export class AuthModule {}
