import { Module } from '@nestjs/common';
import { DocumentModule } from '../document/document.module';
import { MailerService } from './mailer.service';
import { DocumentExpiryNotificationService } from './document-expiry-notification.service';

@Module({
  imports: [DocumentModule],
  providers: [MailerService, DocumentExpiryNotificationService],
  exports: [MailerService, DocumentExpiryNotificationService],
})
export class NotificationModule {}
