import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PaymentAlertKind, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { requestContext } from '../../common/context/request-context';
import { MailerService } from './mailer.service';
import { resolveOwnerRecipients, TenantSummary } from './notification.util';

export const MISSED_PAYMENT_CRON_JOB = 'missed-payment-scan';

/** Marker recorded as the acting user for system-initiated (cron) work. */
const SYSTEM_USER_ID = 'system:missed-payment-scan';

interface ShortAssignment {
  id: string;
  assignedDate: Date;
  targetAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  pendingAmount: Prisma.Decimal;
  kind: PaymentAlertKind;
  riderName: string;
  registrationNumber: string;
}

export interface MissedPaymentScanResult {
  tenantsScanned: number;
  tenantsNotified: number;
  alertsSent: number;
}

/**
 * Daily scan that emails each fleet owner about past assignments where the
 * rider paid nothing (NO_PAYMENT) or paid less than the daily target
 * (SHORTFALL).
 *
 * Design decisions:
 * - Only PAST days are judged (assignedDate strictly before today in UTC) -
 *   today's assignment is still in progress and never alerted.
 * - "Paid" counts PENDING + COMPLETED payments, excluding FAILED. A payment
 *   the rider recorded but the owner hasn't reconciled yet should not accuse
 *   the rider of not paying; the digest shows how much is still pending so
 *   the owner knows reconciliation is the next step.
 * - One alert EVER per assignment (unique dailyAssignmentId). After the owner
 *   has been told a day came up short, follow-up belongs in the dashboard,
 *   not in a daily nag. Late payments that close the gap simply mean no alert
 *   fires in the first place.
 * - Lookback window (MISSED_PAYMENT_LOOKBACK_DAYS, default 7) bounds the scan
 *   so enabling this feature on an old database doesn't email months of
 *   ancient history.
 * - Same safety rails as the document expiry scan: one digest per tenant per
 *   run, alerts recorded only after a successful send (failed sends retry
 *   next day), per-tenant fail-closed context, one tenant's failure never
 *   stops the rest.
 */
@Injectable()
export class MissedPaymentNotificationService implements OnModuleInit {
  private readonly logger = new Logger(MissedPaymentNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    // Never self-schedule inside tests - specs call scanAndNotify() directly.
    if (this.config.get<string>('NODE_ENV') === 'test') {
      return;
    }

    const expression = this.config.get<string>('MISSED_PAYMENT_CRON', '30 7 * * *');
    const timeZone = this.config.get<string>('DOCUMENT_EXPIRY_TZ', 'Africa/Dar_es_Salaam');

    const job = new CronJob(
      expression,
      () => {
        this.scanAndNotify().catch((error: unknown) => {
          this.logger.error(
            'Scheduled missed-payment scan failed',
            error instanceof Error ? error.stack : String(error),
          );
        });
      },
      null,
      false,
      timeZone,
    );

    this.schedulerRegistry.addCronJob(MISSED_PAYMENT_CRON_JOB, job);
    job.start();
    this.logger.log(`Missed-payment scan scheduled: "${expression}" (${timeZone})`);
  }

  async scanAndNotify(now: Date = new Date()): Promise<MissedPaymentScanResult> {
    const tenants = await requestContext.runUnscoped(() =>
      this.prisma.client.tenant.findMany({
        where: { isActive: true },
        select: { id: true, name: true, contactEmail: true },
      }),
    );

    const result: MissedPaymentScanResult = {
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
          `Missed-payment scan failed for tenant ${tenant.id} (${tenant.name}) - continuing`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    this.logger.log(
      `Missed-payment scan done: ${result.tenantsScanned} tenant(s) scanned, ` +
        `${result.tenantsNotified} notified, ${result.alertsSent} new alert(s)`,
    );
    return result;
  }

  private async notifyTenant(tenant: TenantSummary, now: Date): Promise<number> {
    return requestContext.run(
      { tenantId: tenant.id, userId: SYSTEM_USER_ID, role: UserRole.OWNER },
      async () => {
        const lookbackDays = this.config.get<number>('MISSED_PAYMENT_LOOKBACK_DAYS', 7);

        const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const windowStart = new Date(today);
        windowStart.setUTCDate(windowStart.getUTCDate() - lookbackDays);

        const assignments = await this.prisma.client.dailyAssignment.findMany({
          where: {
            assignedDate: { gte: windowStart, lt: today },
            alert: null,
          },
          include: {
            dailyPayments: true,
            rider: { include: { user: { select: { firstName: true, lastName: true } } } },
            motorcycle: { select: { registrationNumber: true } },
          },
          orderBy: { assignedDate: 'asc' },
        });

        const short: ShortAssignment[] = [];
        for (const assignment of assignments) {
          let paid = new Prisma.Decimal(0);
          let pending = new Prisma.Decimal(0);
          for (const payment of assignment.dailyPayments) {
            if (payment.status === PaymentStatus.FAILED) {
              continue;
            }
            paid = paid.plus(payment.amount);
            if (payment.status === PaymentStatus.PENDING) {
              pending = pending.plus(payment.amount);
            }
          }

          if (paid.greaterThanOrEqualTo(assignment.targetAmount)) {
            continue;
          }

          short.push({
            id: assignment.id,
            assignedDate: assignment.assignedDate,
            targetAmount: assignment.targetAmount,
            paidAmount: paid,
            pendingAmount: pending,
            kind: paid.isZero() ? PaymentAlertKind.NO_PAYMENT : PaymentAlertKind.SHORTFALL,
            riderName: `${assignment.rider.user.firstName} ${assignment.rider.user.lastName}`,
            registrationNumber: assignment.motorcycle.registrationNumber,
          });
        }

        if (short.length === 0) {
          return 0;
        }

        const recipients = await resolveOwnerRecipients(this.prisma, tenant);
        if (recipients.length === 0) {
          this.logger.warn(
            `Tenant ${tenant.id} (${tenant.name}) has ${short.length} missed-payment alert(s) ` +
              'but no active OWNER email or tenant contact email - skipping until one exists',
          );
          return 0;
        }

        const sent = await this.mailer.send(this.buildDigest(tenant, short, recipients));
        if (!sent) {
          // Nothing recorded - the next daily run retries this tenant.
          return 0;
        }

        await this.prisma.client.assignmentAlert.createMany({
          data: short.map((item) => ({
            tenantId: tenant.id,
            dailyAssignmentId: item.id,
            kind: item.kind,
            targetAmount: item.targetAmount,
            paidAmount: item.paidAmount,
            sentTo: recipients.join(', '),
          })),
          skipDuplicates: true,
        });

        return short.length;
      },
    );
  }

  private buildDigest(
    tenant: TenantSummary,
    short: ShortAssignment[],
    recipients: string[],
  ): { to: string[]; subject: string; text: string } {
    const missed = short.filter((item) => item.kind === PaymentAlertKind.NO_PAYMENT);
    const underpaid = short.filter((item) => item.kind === PaymentAlertKind.SHORTFALL);

    const parts = [];
    if (missed.length > 0) {
      parts.push(`${missed.length} with no payment`);
    }
    if (underpaid.length > 0) {
      parts.push(`${underpaid.length} under target`);
    }
    const subject = `BongoFleet: ${short.length} daily payment(s) need attention (${parts.join(', ')})`;

    const lines: string[] = [
      `Hello ${tenant.name},`,
      '',
      'The following daily assignments did not reach their payment target:',
    ];

    if (missed.length > 0) {
      lines.push('', 'NO PAYMENT RECORDED:');
      for (const item of missed) {
        lines.push(this.describeAssignment(item));
      }
    }
    if (underpaid.length > 0) {
      lines.push('', 'PAID UNDER TARGET:');
      for (const item of underpaid) {
        lines.push(this.describeAssignment(item));
      }
    }

    lines.push(
      '',
      'Note: amounts include payments still pending reconciliation, shown per line.',
      'Open the BongoFleet dashboard to follow up or reconcile pending payments.',
      '',
      '- BongoFleet',
    );

    return { to: recipients, subject, text: lines.join('\n') };
  }

  private describeAssignment(item: ShortAssignment): string {
    const date = item.assignedDate.toISOString().slice(0, 10);
    const shortfall = new Prisma.Decimal(item.targetAmount).minus(item.paidAmount);
    const pendingNote = item.pendingAmount.isZero()
      ? ''
      : ` (${item.pendingAmount.toFixed(2)} of this is pending reconciliation)`;
    return (
      `  - ${date}: ${item.riderName} on ${item.registrationNumber} - ` +
      `paid ${item.paidAmount.toFixed(2)} of ${item.targetAmount.toFixed(2)}, ` +
      `short by ${shortfall.toFixed(2)}${pendingNote}`
    );
  }
}
