import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Document, DocumentAlert, DocumentAlertKind, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { requestContext } from '../../common/context/request-context';
import { computeDocumentStatus, DocumentService } from '../document/document.service';
import { MailerService } from './mailer.service';
import { resolveOwnerRecipients, TenantSummary } from './notification.util';

export const DOCUMENT_EXPIRY_CRON_JOB = 'document-expiry-scan';

/** Marker recorded as the acting user for system-initiated (cron) work. */
const SYSTEM_USER_ID = 'system:document-expiry-scan';

interface PendingAlert {
  document: Document & { alerts: DocumentAlert[] };
  kind: DocumentAlertKind;
}

export interface ExpiryScanResult {
  tenantsScanned: number;
  tenantsNotified: number;
  alertsSent: number;
}

/**
 * Daily scan that emails each fleet owner about documents that have expired
 * or will expire within DOCUMENT_EXPIRY_ALERT_DAYS (default 30) days.
 *
 * Design decisions:
 * - One digest email per tenant per run - never one email per document.
 * - Deduped via the DocumentAlert table: a document alerts at most once as
 *   EXPIRING_SOON and once more as EXPIRED (unique [documentId, kind]).
 *   Re-uploading a document creates a new document id, so a renewed paper
 *   alerts afresh when its new expiry date approaches.
 * - Alerts are recorded only AFTER a successful send - a failed email is
 *   retried automatically on the next daily run.
 * - Each tenant is processed inside its own tenant context
 *   (requestContext.run), so every query stays scoped by the same fail-closed
 *   Prisma extension that protects HTTP requests. Only the initial tenant
 *   enumeration runs unscoped.
 * - One tenant's failure is logged and skipped; the scan continues for the
 *   rest of the fleet owners.
 */
@Injectable()
export class DocumentExpiryNotificationService implements OnModuleInit {
  private readonly logger = new Logger(DocumentExpiryNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
    private readonly documentService: DocumentService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    // Never self-schedule inside tests - specs call scanAndNotify() directly.
    if (this.config.get<string>('NODE_ENV') === 'test') {
      return;
    }

    const expression = this.config.get<string>('DOCUMENT_EXPIRY_CRON', '0 7 * * *');
    const timeZone = this.config.get<string>('DOCUMENT_EXPIRY_TZ', 'Africa/Dar_es_Salaam');

    const job = new CronJob(
      expression,
      () => {
        this.scanAndNotify().catch((error: unknown) => {
          this.logger.error(
            'Scheduled document expiry scan failed',
            error instanceof Error ? error.stack : String(error),
          );
        });
      },
      null,
      false,
      timeZone,
    );

    this.schedulerRegistry.addCronJob(DOCUMENT_EXPIRY_CRON_JOB, job);
    job.start();
    this.logger.log(`Document expiry scan scheduled: "${expression}" (${timeZone})`);
  }

  async scanAndNotify(now: Date = new Date()): Promise<ExpiryScanResult> {
    const tenants = await requestContext.runUnscoped(() =>
      this.prisma.client.tenant.findMany({
        where: { isActive: true },
        select: { id: true, name: true, contactEmail: true },
      }),
    );

    const result: ExpiryScanResult = {
      tenantsScanned: tenants.length,
      tenantsNotified: 0,
      alertsSent: 0,
    };

    for (const tenant of tenants) {
      try {
        const sent = await this.notifyTenant(tenant, now);
        if (sent > 0) {
          result.tenantsNotified += 1;
          result.alertsSent += sent;
        }
      } catch (error) {
        this.logger.error(
          `Document expiry scan failed for tenant ${tenant.id} (${tenant.name}) - continuing`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    this.logger.log(
      `Document expiry scan done: ${result.tenantsScanned} tenant(s) scanned, ` +
        `${result.tenantsNotified} notified, ${result.alertsSent} new alert(s)`,
    );
    return result;
  }

  private async notifyTenant(tenant: TenantSummary, now: Date): Promise<number> {
    return requestContext.run(
      { tenantId: tenant.id, userId: SYSTEM_USER_ID, role: UserRole.OWNER },
      async () => {
        const withinDays = this.config.get<number>('DOCUMENT_EXPIRY_ALERT_DAYS', 30);

        const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const horizon = new Date(today);
        horizon.setUTCDate(horizon.getUTCDate() + withinDays);

        const documents = await this.prisma.client.document.findMany({
          where: { expiryDate: { not: null, lte: horizon } },
          include: { alerts: true },
          orderBy: { expiryDate: 'asc' },
        });

        const pending: PendingAlert[] = [];
        for (const document of documents) {
          const status = computeDocumentStatus(document.expiryDate, withinDays, now);
          if (status === 'VALID') {
            continue;
          }
          const kind =
            status === 'EXPIRED' ? DocumentAlertKind.EXPIRED : DocumentAlertKind.EXPIRING_SOON;
          if (!document.alerts.some((alert) => alert.kind === kind)) {
            pending.push({ document, kind });
          }
        }

        if (pending.length === 0) {
          return 0;
        }

        const recipients = await resolveOwnerRecipients(this.prisma, tenant);
        if (recipients.length === 0) {
          this.logger.warn(
            `Tenant ${tenant.id} (${tenant.name}) has ${pending.length} document alert(s) ` +
              'but no active OWNER email or tenant contact email - skipping until one exists',
          );
          return 0;
        }

        const ownerLabels = await this.documentService.buildOwnerLabels(
          pending.map(({ document }) => document),
        );

        const sent = await this.mailer.send(
          this.buildDigest(tenant, pending, withinDays, recipients, ownerLabels),
        );
        if (!sent) {
          // Nothing recorded - the next daily run retries this tenant.
          return 0;
        }

        await this.prisma.client.documentAlert.createMany({
          data: pending.map(({ document, kind }) => ({
            tenantId: tenant.id,
            documentId: document.id,
            kind,
            sentTo: recipients.join(', '),
          })),
          skipDuplicates: true,
        });

        return pending.length;
      },
    );
  }

  private buildDigest(
    tenant: TenantSummary,
    pending: PendingAlert[],
    withinDays: number,
    recipients: string[],
    ownerLabels: Map<string, string>,
  ): { to: string[]; subject: string; text: string } {
    const expired = pending.filter(({ kind }) => kind === DocumentAlertKind.EXPIRED);
    const expiringSoon = pending.filter(({ kind }) => kind === DocumentAlertKind.EXPIRING_SOON);

    const parts = [];
    if (expired.length > 0) {
      parts.push(`${expired.length} expired`);
    }
    if (expiringSoon.length > 0) {
      parts.push(`${expiringSoon.length} expiring soon`);
    }
    const subject = `BongoFleet: ${pending.length} document(s) need attention (${parts.join(', ')})`;

    const lines: string[] = [
      `Hello ${tenant.name},`,
      '',
      'The following fleet documents need your attention:',
    ];

    if (expired.length > 0) {
      lines.push('', 'EXPIRED:');
      for (const { document } of expired) {
        lines.push(this.describeDocument(document, 'expired on', ownerLabels));
      }
    }
    if (expiringSoon.length > 0) {
      lines.push('', `EXPIRING WITHIN ${withinDays} DAYS:`);
      for (const { document } of expiringSoon) {
        lines.push(this.describeDocument(document, 'expires on', ownerLabels));
      }
    }

    lines.push(
      '',
      'Open the BongoFleet dashboard to renew and re-upload these documents.',
      '',
      '- BongoFleet',
    );

    return { to: recipients, subject, text: lines.join('\n') };
  }

  private describeDocument(
    document: PendingAlert['document'],
    verb: string,
    ownerLabels: Map<string, string>,
  ): string {
    const docType = document.docType.replace(/_/g, ' ');
    const reference = document.referenceNumber ? ` (ref ${document.referenceNumber})` : '';
    const date = document.expiryDate ? document.expiryDate.toISOString().slice(0, 10) : 'unknown';
    const label = ownerLabels.get(`${document.ownerType}:${document.ownerId}`) ?? document.ownerId;
    const owner = `${document.ownerType.toLowerCase()} ${label}`;
    return `  - [${owner}] ${docType}${reference} - ${verb} ${date}`;
  }
}
