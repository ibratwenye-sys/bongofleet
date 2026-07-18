import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
}

/**
 * Thin, provider-agnostic email sender.
 *
 * With SMTP_HOST configured it sends real mail over SMTP (works with any
 * relay: SES, Mailgun, Zoho, a Gmail app password, ...). With SMTP_HOST left
 * blank it runs in "log-only" mode: the message is written to the app log and
 * reported as sent. That keeps development and tests free of external calls
 * while exercising the exact same code path callers see in production.
 *
 * Security notes (claude/SECURITY_AND_SCALING_REQUIREMENTS.md §1.4):
 * - credentials come only from env, never code;
 * - explicit connection/greeting/socket timeouts so a dead SMTP server can
 *   never hang a request or job forever;
 * - failures are caught and reported as `false`, never thrown into callers.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.from = config.get<string>('MAIL_FROM', 'BongoFleet <no-reply@bongofleet.app>');

    const host = config.get<string>('SMTP_HOST', '');
    if (!host) {
      this.transporter = null;
      return;
    }

    const user = config.get<string>('SMTP_USER', '');
    this.transporter = nodemailer.createTransport({
      host,
      port: config.get<number>('SMTP_PORT', 587),
      secure: config.get<boolean>('SMTP_SECURE', false),
      auth: user ? { user, pass: config.get<string>('SMTP_PASS', '') } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  /** True when a real SMTP transport is configured (not log-only mode). */
  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  /** Returns true when the message was sent (or logged, in log-only mode). */
  async send(message: MailMessage): Promise<boolean> {
    if (!this.transporter) {
      this.logger.log(
        `[log-only mail] to=${message.to.join(', ')} subject="${message.subject}"\n${message.text}`,
      );
      return true;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: message.to.join(', '),
        subject: message.subject,
        text: message.text,
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send "${message.subject}" to ${message.to.join(', ')}`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }
}
