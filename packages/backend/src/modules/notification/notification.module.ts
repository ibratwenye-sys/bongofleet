import { Module } from '@nestjs/common';
import { DocumentModule } from '../document/document.module';
import { MailerService } from './mailer.service';
import { DocumentExpiryNotificationService } from './document-expiry-notification.service';
import { MissedPaymentNotificationService } from './missed-payment-notification.service';
import { MaintenanceReminderNotificationService } from './maintenance-reminder-notification.service';

@Module({
  imports: [DocumentModule],
  providers: [
    MailerService,
    DocumentExpiryNotificationService,
    MissedPaymentNotificationService,
    MaintenanceReminderNotificationService,
  ],
  exports: [
    MailerService,
    DocumentExpiryNotificationService,
    MissedPaymentNotificationService,
    MaintenanceReminderNotificationService,
  ],
})
export class NotificationModule {}
