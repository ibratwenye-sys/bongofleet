import { Module } from '@nestjs/common';
import { DocumentModule } from '../document/document.module';
import { MailerService } from './mailer.service';
import { DocumentExpiryNotificationService } from './document-expiry-notification.service';
import { MissedPaymentNotificationService } from './missed-payment-notification.service';

@Module({
  imports: [DocumentModule],
  providers: [MailerService, DocumentExpiryNotificationService, MissedPaymentNotificationService],
  exports: [MailerService, DocumentExpiryNotificationService, MissedPaymentNotificationService],
})
export class NotificationModule {}
