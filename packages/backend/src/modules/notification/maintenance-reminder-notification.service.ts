import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { MaintenanceReminderKind, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { requestContext } from '../../common/context/request-context';
import { MailerService } from './mailer.service';
import { resolveOwnerRecipients, TenantSummary } from './notification.util';

export const MAINTENANCE_REMINDER_CRON_JOB = 'maintenance-reminder-scan';

/** Marker recorded as the acting user for system-initiated (cron) work. */
const SYSTEM_USER_ID = 'system:maintenance-reminder-scan';

interface DueService {
  logId: string;
  registrationNumber: string;
  description: string;
  kind: MaintenanceReminderKind;
  reasons: string[];
}

export interface MaintenanceReminderScanResult {
  tenantsScanned: number;
  tenantsNotified: number;
  remindersSent: number;
}

/**
 * Daily scan that emails each fleet owner about motorcycles due (or overdue)
 * for service. A bike's outstanding service target is the next-service date /
 * mileage recorded on its most recent maintenance log that has one.
 *
 * Due logic (per bike's latest target-bearing log):
 * - OVERDUE if nextServiceDate is before today, OR currentMileage >=
 *   nextServiceMileage.
 * - DUE_SOON if nextServiceDate is within MAINTENANCE_REMINDER_DAYS (default
 *   14), OR currentMileage >= nextServiceMileage - MAINTENANCE_REMINDER_MILEAGE
 *   (default 500). Date and mileage are OR'd: whichever comes first wins.
 *
 * Dedupe mirrors the document/payment scans: unique [maintenanceLogId, kind]
 * with DUE_SOON escalating to OVERDUE. Logging a new service creates a new log
 * (a new target), which reminds afresh. Alerts recorded only after a successful
 * send; per-tenant fail-closed context; one tenant's failure never stops the
 * rest.
 */
@Injectable()
export class MaintenanceReminderNotificationService implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceReminderNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      return;
    }

    const expression = this.config.get<string>('MAINTENANCE_REMINDER_CRON', '0 8 * * *');
    const timeZone = this.config.get<string>('DOCUMENT_EXPIRY_TZ', 'Africa/Dar_es_Salaam');

    const job = new CronJob(
      expression,
      () => {
        this.scanAndNotify().catch((error: unknown) => {
          this.logger.error(
            'Scheduled maintenance-reminder scan failed',
            error instanceof Error ? error.stack : String(error),
          );
        });
      },
      null,
      false,
      timeZone,
    );

    this.schedulerRegistry.addCronJob(MAINTENANCE_REMINDER_CRON_JOB, job);
    job.start();
    this.logger.log(`Maintenance-reminder scan scheduled: "${expression}" (${timeZone})`);
  }

  async scanAndNotify(now: Date = new Date()): Promise<MaintenanceReminderScanResult> {
    const tenants = await requestContext.runUnscoped(() =>
      this.prisma.client.tenant.findMany({
        where: { isActive: true },
        select: { id: true, name: true, contactEmail: true },
      }),
    );

    const result: MaintenanceReminderScanResult = {
      tenantsScanned: tenants.length,
      tenantsNotified: 0,
      remindersSent: 0,
    };

    for (const tenant of tenants) {
      try {
        const sent = await this.notifyTenant(tenant, now);
        if (sent > 0) {
          result.tenantsNotified += 1;
          result.remindersSent += sent;
        }
      } catch (error) {
        this.logger.error(
          `Maintenance-reminder scan failed for tenant ${tenant.id} (${tenant.name}) - continuing`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    this.logger.log(
      `Maintenance-reminder scan done: ${result.tenantsScanned} tenant(s) scanned, ` +
        `${result.tenantsNotified} notified, ${result.remindersSent} new reminder(s)`,
    );
    return result;
  }

  private async notifyTenant(tenant: TenantSummary, now: Date): Promise<number> {
    return requestContext.run(
      { tenantId: tenant.id, userId: SYSTEM_USER_ID, role: UserRole.OWNER },
      async () => {
        const withinDays = this.config.get<number>('MAINTENANCE_REMINDER_DAYS', 14);
        const mileageBuffer = this.config.get<number>('MAINTENANCE_REMINDER_MILEAGE', 500);

        const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const dateHorizon = new Date(today);
        dateHorizon.setUTCDate(dateHorizon.getUTCDate() + withinDays);

        // Active bikes with at least one maintenance log carrying a next-service
        // target. We only need the newest such log per bike (its current target).
        const motorcycles = await this.prisma.client.motorcycle.findMany({
          where: {
            isActive: true,
            maintenanceLogs: {
              some: {
                OR: [{ nextServiceDate: { not: null } }, { nextServiceMileage: { not: null } }],
              },
            },
          },
          select: {
            id: true,
            registrationNumber: true,
            currentMileage: true,
            maintenanceLogs: {
              where: {
                OR: [{ nextServiceDate: { not: null } }, { nextServiceMileage: { not: null } }],
              },
              orderBy: { performedAt: 'desc' },
              take: 1,
              select: {
                id: true,
                description: true,
                nextServiceDate: true,
                nextServiceMileage: true,
                reminders: { select: { kind: true } },
              },
            },
          },
        });

        const due: DueService[] = [];
        for (const bike of motorcycles) {
          const log = bike.maintenanceLogs[0];
          if (!log) {
            continue;
          }

          const reasons: string[] = [];
          let overdue = false;
          let dueSoon = false;

          if (log.nextServiceDate) {
            const target = log.nextServiceDate;
            if (target.getTime() < today.getTime()) {
              overdue = true;
              reasons.push(`service was due ${target.toISOString().slice(0, 10)}`);
            } else if (target.getTime() <= dateHorizon.getTime()) {
              dueSoon = true;
              reasons.push(`service due by ${target.toISOString().slice(0, 10)}`);
            }
          }

          if (log.nextServiceMileage != null) {
            if (bike.currentMileage >= log.nextServiceMileage) {
              overdue = true;
              reasons.push(
                `odometer ${bike.currentMileage} km past service target ${log.nextServiceMileage} km`,
              );
            } else if (bike.currentMileage >= log.nextServiceMileage - mileageBuffer) {
              dueSoon = true;
              reasons.push(
                `odometer ${bike.currentMileage} km nearing service target ${log.nextServiceMileage} km`,
              );
            }
          }

          if (!overdue && !dueSoon) {
            continue;
          }
          const kind = overdue ? MaintenanceReminderKind.OVERDUE : MaintenanceReminderKind.DUE_SOON;
          if (log.reminders.some((r) => r.kind === kind)) {
            continue;
          }

          due.push({
            logId: log.id,
            registrationNumber: bike.registrationNumber,
            description: log.description,
            kind,
            reasons,
          });
        }

        if (due.length === 0) {
          return 0;
        }

        const recipients = await resolveOwnerRecipients(this.prisma, tenant);
        if (recipients.length === 0) {
          this.logger.warn(
            `Tenant ${tenant.id} (${tenant.name}) has ${due.length} maintenance reminder(s) ` +
              'but no active OWNER email or tenant contact email - skipping until one exists',
          );
          return 0;
        }

        const sent = await this.mailer.send(this.buildDigest(tenant, due, recipients));
        if (!sent) {
          return 0;
        }

        await this.prisma.client.maintenanceReminder.createMany({
          data: due.map((item) => ({
            tenantId: tenant.id,
            maintenanceLogId: item.logId,
            kind: item.kind,
            sentTo: recipients.join(', '),
          })),
          skipDuplicates: true,
        });

        return due.length;
      },
    );
  }

  private buildDigest(
    tenant: TenantSummary,
    due: DueService[],
    recipients: string[],
  ): { to: string[]; subject: string; text: string } {
    const overdue = due.filter((d) => d.kind === MaintenanceReminderKind.OVERDUE);
    const soon = due.filter((d) => d.kind === MaintenanceReminderKind.DUE_SOON);

    const parts = [];
    if (overdue.length > 0) parts.push(`${overdue.length} overdue`);
    if (soon.length > 0) parts.push(`${soon.length} due soon`);
    const subject = `BongoFleet: ${due.length} motorcycle(s) need servicing (${parts.join(', ')})`;

    const lines: string[] = [
      `Hello ${tenant.name},`,
      '',
      'The following motorcycles are due for maintenance:',
    ];

    if (overdue.length > 0) {
      lines.push('', 'OVERDUE:');
      for (const item of overdue) {
        lines.push(
          `  - ${item.registrationNumber} (${item.description}) - ${item.reasons.join('; ')}`,
        );
      }
    }
    if (soon.length > 0) {
      lines.push('', 'DUE SOON:');
      for (const item of soon) {
        lines.push(
          `  - ${item.registrationNumber} (${item.description}) - ${item.reasons.join('; ')}`,
        );
      }
    }

    lines.push(
      '',
      'Log the service in the BongoFleet dashboard once it is done.',
      '',
      '- BongoFleet',
    );
    return { to: recipients, subject, text: lines.join('\n') };
  }
}
