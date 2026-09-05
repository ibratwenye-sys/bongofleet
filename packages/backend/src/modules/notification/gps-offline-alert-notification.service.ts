import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { TrackingMode, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { requestContext } from '../../common/context/request-context';
import {
  dateOnlyInDarEsSalaam,
  DAR_ES_SALAAM_UTC_OFFSET_MS,
} from '../ownership-plan/ownership-plan.derivation';
import {
  CURRENT_POSITION_FIX_LOOKBACK,
  resolveCurrentPosition,
  type GpsFixCandidate,
} from '../gps/current-position';
import { MailerService } from './mailer.service';
import { resolveOwnerRecipients, TenantSummary } from './notification.util';

export const GPS_OFFLINE_ALERT_CRON_JOB = 'gps-offline-alert-scan';

/** Marker recorded as the acting user for system-initiated (cron) work,
 *  same convention as missed-payment-notification.service.ts's own
 *  SYSTEM_USER_ID. */
const SYSTEM_USER_ID = 'system:gps-offline-alert-scan';

// Same field selection as gps.service.ts's own FIX_SELECT (getFleetPositions) -
// exactly what resolveCurrentPosition needs, nothing more.
const FIX_SELECT = { source: true, latitude: true, longitude: true, recordedAt: true } as const;

export interface GpsOfflineAlertScanResult {
  tenantsScanned: number;
  tenantsNotified: number;
  alertsSent: number;
}

interface OfflineCandidate {
  motorcycleId: string;
  registrationNumber: string;
  lastRecordedAt: Date;
}

type TenantWithTrackingHours = TenantSummary & {
  trackingStartHour: number | null;
  trackingEndHour: number | null;
};

/** "3 h 20 min" / "45 min" - never invents a unit smaller than a minute. */
function humanGap(from: Date, to: Date): string {
  const totalMinutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes} min` : `${hours} h ${minutes} min`;
}

/**
 * DESIGN_GPS_TRACKING.md §6 - the "offline vehicle" health alert. The other
 * two §6 alert types ("box silent phone moving", "vehicle moving with no
 * assignment") need real DEVICE fixes flowing from a paired Traccar
 * account, which isn't set up yet - not built here.
 *
 * Cron-registration shape copied from missed-payment-notification.service.ts
 * exactly: CronJob via SchedulerRegistry.addCronJob() inside onModuleInit(),
 * early return under NODE_ENV=test (specs call scanAndNotify() directly),
 * DOCUMENT_EXPIRY_TZ for its timezone (not a second timezone env var).
 *
 * Deliberately NOT AssignmentAlert's "once ever" dedup shape - see
 * GpsOfflineAlert's own schema comment: while a vehicle stays offline, a
 * fresh email fires every day the scan still finds it offline, keyed on
 * [motorcycleId, alertDate].
 */
@Injectable()
export class GpsOfflineAlertNotificationService implements OnModuleInit {
  private readonly logger = new Logger(GpsOfflineAlertNotificationService.name);

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

    const expression = this.config.get<string>('GPS_OFFLINE_ALERT_CRON', '0 8 * * *');
    const timeZone = this.config.get<string>('DOCUMENT_EXPIRY_TZ', 'Africa/Dar_es_Salaam');

    const job = new CronJob(
      expression,
      () => {
        this.scanAndNotify().catch((error: unknown) => {
          this.logger.error(
            'Scheduled GPS offline-vehicle scan failed',
            error instanceof Error ? error.stack : String(error),
          );
        });
      },
      null,
      false,
      timeZone,
    );

    this.schedulerRegistry.addCronJob(GPS_OFFLINE_ALERT_CRON_JOB, job);
    job.start();
    this.logger.log(`GPS offline-vehicle scan scheduled: "${expression}" (${timeZone})`);
  }

  async scanAndNotify(now: Date = new Date()): Promise<GpsOfflineAlertScanResult> {
    const tenants = await requestContext.runUnscoped(() =>
      this.prisma.client.tenant.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          contactEmail: true,
          trackingStartHour: true,
          trackingEndHour: true,
        },
      }),
    );

    const result: GpsOfflineAlertScanResult = {
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
          `GPS offline-vehicle scan failed for tenant ${tenant.id} (${tenant.name}) - continuing`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    this.logger.log(
      `GPS offline-vehicle scan done: ${result.tenantsScanned} tenant(s) scanned, ` +
        `${result.tenantsNotified} notified, ${result.alertsSent} new alert(s)`,
    );
    return result;
  }

  private async notifyTenant(tenant: TenantWithTrackingHours, now: Date): Promise<number> {
    return requestContext.run(
      { tenantId: tenant.id, userId: SYSTEM_USER_ID, role: UserRole.OWNER },
      async () => {
        if (!this.isWithinTrackingHours(tenant, now)) {
          return 0;
        }

        const today = dateOnlyInDarEsSalaam(now);

        // Same batched-fetch shape as GpsService.getFleetPositions - one
        // query for every eligible motorcycle, each with its own nested
        // lookback fixes, never one query per vehicle. Unlike
        // getFleetPositions (which intentionally shows every active
        // vehicle on the live map regardless of tracking setup), this
        // excludes trackingMode: NONE - a vehicle the owner deliberately
        // isn't tracking must never generate an offline alert.
        const motorcycles = await this.prisma.client.motorcycle.findMany({
          where: { isActive: true, trackingMode: { not: TrackingMode.NONE } },
          select: {
            id: true,
            registrationNumber: true,
            gpsLocations: {
              orderBy: { recordedAt: 'desc' },
              take: CURRENT_POSITION_FIX_LOOKBACK,
              select: FIX_SELECT,
            },
          },
        });

        const offline: OfflineCandidate[] = [];
        for (const m of motorcycles) {
          const resolved = resolveCurrentPosition(m.gpsLocations as GpsFixCandidate[], now);
          if (!resolved.offline) {
            continue;
          }
          // A vehicle that has never reported a single fix is "not
          // configured", not "offline" - alerting on it would fire
          // immediately for every newly onboarded or not-yet-paired
          // vehicle before the owner has done anything wrong. Same "don't
          // fabricate urgency the data doesn't support" discipline as
          // DM13/DM15's own scope cuts.
          if (!resolved.lastRecordedAt) {
            continue;
          }
          offline.push({
            motorcycleId: m.id,
            registrationNumber: m.registrationNumber,
            lastRecordedAt: resolved.lastRecordedAt,
          });
        }

        if (offline.length === 0) {
          return 0;
        }

        // Batched: which of today's offline vehicles already got an email
        // this run (a retry after a partial failure) - one query, not one
        // per vehicle.
        const alreadyAlerted = await this.prisma.client.gpsOfflineAlert.findMany({
          where: { motorcycleId: { in: offline.map((o) => o.motorcycleId) }, alertDate: today },
          select: { motorcycleId: true },
        });
        const alreadyAlertedIds = new Set(alreadyAlerted.map((a) => a.motorcycleId));
        const toAlert = offline.filter((o) => !alreadyAlertedIds.has(o.motorcycleId));

        if (toAlert.length === 0) {
          return 0;
        }

        const recipients = await resolveOwnerRecipients(this.prisma, tenant);
        if (recipients.length === 0) {
          this.logger.warn(
            `Tenant ${tenant.id} (${tenant.name}) has ${toAlert.length} offline vehicle(s) ` +
              'but no active OWNER email or tenant contact email - skipping until one exists',
          );
          return 0;
        }

        const sent = await this.mailer.send(this.buildDigest(tenant, toAlert, recipients, now));
        if (!sent) {
          // Nothing recorded - the next run retries this tenant.
          return 0;
        }

        await this.prisma.client.gpsOfflineAlert.createMany({
          data: toAlert.map((o) => ({
            tenantId: tenant.id,
            motorcycleId: o.motorcycleId,
            alertDate: today,
            lastRecordedAt: o.lastRecordedAt,
            sentTo: recipients.join(', '),
          })),
          skipDuplicates: true,
        });

        return toAlert.length;
      },
    );
  }

  /**
   * Stage I1's own documented (until now unenforced) semantics for
   * Tenant.trackingStartHour/trackingEndHour: both null (the current,
   * universal state - nobody has set these yet) means unrestricted,
   * always eligible. Only when BOTH are set does this restrict alerting to
   * the [start, end) hour window, in Africa/Dar_es_Salaam local time -
   * "unset" is never treated as "disabled".
   */
  private isWithinTrackingHours(tenant: TenantWithTrackingHours, now: Date): boolean {
    if (tenant.trackingStartHour === null || tenant.trackingEndHour === null) {
      return true;
    }
    const localHour = new Date(now.getTime() + DAR_ES_SALAAM_UTC_OFFSET_MS).getUTCHours();
    return localHour >= tenant.trackingStartHour && localHour < tenant.trackingEndHour;
  }

  private buildDigest(
    tenant: TenantSummary,
    offline: OfflineCandidate[],
    recipients: string[],
    now: Date,
  ): { to: string[]; subject: string; text: string } {
    const subject = `BongoFleet: ${offline.length} vehicle(s) offline`;

    const lines: string[] = [
      `Hello ${tenant.name},`,
      '',
      'The following tracked vehicles have not reported a position recently:',
      '',
    ];
    for (const o of offline) {
      lines.push(`  - ${o.registrationNumber}: offline for ${humanGap(o.lastRecordedAt, now)}`);
    }
    lines.push(
      '',
      "Check the vehicle's GPS device or the rider's phone connectivity.",
      'Open the BongoFleet dashboard to see live positions.',
      '',
      '- BongoFleet',
    );

    return { to: recipients, subject, text: lines.join('\n') };
  }
}
