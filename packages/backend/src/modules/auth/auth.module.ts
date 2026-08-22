import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { SignupVerificationService } from './signup-verification.service';
import { AbandonedSignupCleanupService } from './abandoned-signup-cleanup.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { NotificationModule } from '../notification/notification.module';
import { VerificationCodeService } from '../../common/verification-code/verification-code.service';

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
  providers: [
    AuthService,
    PasswordResetService,
    // Stage S1 - shared code-verification core (see its own doc comment)
    // and the two things built on it.
    VerificationCodeService,
    SignupVerificationService,
    AbandonedSignupCleanupService,
    JwtStrategy,
    JwtAuthGuard,
  ],
  exports: [AuthService, PasswordResetService],
})
export class AuthModule {}
