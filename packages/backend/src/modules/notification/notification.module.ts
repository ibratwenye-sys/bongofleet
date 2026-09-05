import { Module } from '@nestjs/common';
import { DocumentModule } from '../document/document.module';
import { MailerService } from './mailer.service';
import { DocumentExpiryNotificationService } from './document-expiry-notification.service';
import { MissedPaymentNotificationService } from './missed-payment-notification.service';
import { MaintenanceReminderNotificationService } from './maintenance-reminder-notification.service';
import { GpsOfflineAlertNotificationService } from './gps-offline-alert-notification.service';

@Module({
  imports: [DocumentModule],
  providers: [
    MailerService,
    DocumentExpiryNotificationService,
    MissedPaymentNotificationService,
    MaintenanceReminderNotificationService,
    GpsOfflineAlertNotificationService,
  ],
  exports: [
    MailerService,
    DocumentExpiryNotificationService,
    MissedPaymentNotificationService,
    MaintenanceReminderNotificationService,
    GpsOfflineAlertNotificationService,
  ],
})
export class NotificationModule {}
