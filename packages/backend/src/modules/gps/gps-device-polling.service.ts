import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { GpsSource, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { requestContext } from '../../common/context/request-context';
import { decryptCredentials } from '../../common/credentials-encryption';
import { TraccarApiError, TraccarClient, TraccarDevice, TraccarPosition } from './traccar-client';

export const GPS_DEVICE_POLL_CRON_JOB = 'gps-device-poll';

/** Marker recorded as the acting user for system-initiated (cron) work,
 *  same convention as missed-payment-notification.service.ts's own
 *  SYSTEM_USER_ID. */
const SYSTEM_USER_ID = 'system:gps-device-poll';

/** 1 knot = 1.852 km/h exactly - Traccar's Position.speed is in knots per
 *  its OpenAPI spec, GpsLocation.speedKmh is km/h. */
const KNOTS_TO_KMH = 1.852;

export interface GpsDevicePollScanResult {
  configsScanned: number;
  configsFailed: number;
  fixesWritten: number;
}

function resolvePositionTimestamp(position: TraccarPosition): Date | null {
  const raw = position.fixTime || position.deviceTime;
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Traccar's OpenAPI spec leaves Position.attributes untyped (no documented
 * sub-keys) - "batteryLevel" is a commonly-seen key in Traccar protocol
 * decoders, NOT something the formal spec guarantees. Read defensively: any
 * other shape just leaves batteryPercent null, same as a device that never
 * reports it at all - never a thrown error over an unexpected attributes
 * shape.
 */
function extractBatteryPercent(attributes: Record<string, unknown> | undefined): number | null {
  const raw = attributes?.['batteryLevel'];
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : null;
}

function shortErrorMessage(error: unknown): string {
  if (error instanceof TraccarApiError) {
    return error.message;
  }
  return error instanceof Error ? error.message : 'Unknown error while polling Traccar';
}

/**
 * Stage 1b (DESIGN_GPS_TRACKING.md §5) - BongoFleet's own cron pulls each
 * tenant's Traccar server on a schedule, rather than Traccar pushing to us.
 * Cron-registration shape copied from missed-payment-notification.service.ts
 * exactly: CronJob via SchedulerRegistry.addCronJob() inside onModuleInit(),
 * early return under NODE_ENV=test (specs call scanAll()/pollTenantConfig
 * directly), Africa/Dar_es_Salaam timezone.
 *
 * This is the first SUB-DAILY cron in this codebase (every daily job here
 * uses a fixed hour-and-minute expression) - worth a note: a step
 * expression on the cron minutes field (an asterisk, a slash, then N) is
 * ordinary, valid cron syntax, and the `cron` package (and node-cron/
 * croner-family libraries generally) handles it no differently from a
 * fixed one; nothing about running every few minutes instead of once a day
 * requires different handling here. The only real difference is overlap
 * risk - a single tenant's poll could in principle still be running when
 * the next tick fires - which isn't guarded against this stage (matches
 * the missed-payment/ownership-plan-generator crons' own lack of an
 * overlap guard; worth revisiting if a slow Traccar server ever makes this
 * matter in practice).
 */
@Injectable()
export class GpsDevicePollingService implements OnModuleInit {
  private readonly logger = new Logger(GpsDevicePollingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly traccar: TraccarClient,
  ) {}

  onModuleInit(): void {
    // Never self-schedule inside tests - specs call scanAll() directly.
    if (this.config.get<string>('NODE_ENV') === 'test') {
      return;
    }

    const intervalMinutes = this.config.get<number>('GPS_DEVICE_POLL_INTERVAL_MINUTES', 3);
    const expression = `*/${intervalMinutes} * * * *`;
    const timeZone = 'Africa/Dar_es_Salaam';

    const job = new CronJob(
      expression,
      () => {
        this.scanAll().catch((error: unknown) => {
          this.logger.error(
            'Scheduled GPS device poll failed',
            error instanceof Error ? error.stack : String(error),
          );
        });
      },
      null,
      false,
      timeZone,
    );

    this.schedulerRegistry.addCronJob(GPS_DEVICE_POLL_CRON_JOB, job);
    job.start();
    this.logger.log(`GPS device poll scheduled: "${expression}" (${timeZone})`);
  }

  /**
   * Every active GpsProviderConfig across every tenant - a cross-tenant
   * system job, same shape as the missed-payment scan and the ownership-
   * plan generator: the listing itself runs requestContext.runUnscoped()
   * (GpsProviderConfig is ordinary tenant-scoped data, not excluded from
   * the Prisma extension, so an unscoped context is required to see every
   * tenant's rows at once), then each tenant's actual poll runs inside its
   * own requestContext.run({tenantId, ...}) so every query it makes -
   * Motorcycle, GpsLocation - is auto-scoped to that one tenant by the
   * extension, same as an ordinary request. One tenant's failure is caught
   * and logged, never stopping the rest.
   */
  async scanAll(): Promise<GpsDevicePollScanResult> {
    const configs = await requestContext.runUnscoped(() =>
      this.prisma.client.gpsProviderConfig.findMany({
        where: { isActive: true },
        select: { id: true, tenantId: true, baseUrl: true, credentialsEncrypted: true },
      }),
    );

    const result: GpsDevicePollScanResult = {
      configsScanned: configs.length,
      configsFailed: 0,
      fixesWritten: 0,
    };

    for (const config of configs) {
      try {
        result.fixesWritten += await this.pollTenantConfig(config);
      } catch (error) {
        result.configsFailed += 1;
        this.logger.error(
          `GPS poll failed for tenant ${config.tenantId} (config ${config.id}) - continuing`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    this.logger.log(
      `GPS device poll done: ${result.configsScanned} config(s) scanned, ` +
        `${result.configsFailed} failed, ${result.fixesWritten} new fix(es) written`,
    );
    return result;
  }

  /**
   * One config's poll. Never throws out of here on a Traccar-side failure
   * (network error or non-2xx) - that's recorded as lastErrorMessage/
   * lastPolledAt and the method returns 0, exactly like a poll that
   * legitimately found nothing new. Only a genuinely unexpected error
   * (e.g. a DB write failing) propagates, to be caught and logged by
   * scanAll()'s own per-config try/catch.
   */
  async pollTenantConfig(config: {
    id: string;
    tenantId: string;
    baseUrl: string;
    credentialsEncrypted: Uint8Array;
  }): Promise<number> {
    return requestContext.run(
      { tenantId: config.tenantId, userId: SYSTEM_USER_ID, role: UserRole.OWNER },
      async () => {
        const now = new Date();

        let token: string;
        try {
          const envelope = JSON.parse(
            decryptCredentials(Buffer.from(config.credentialsEncrypted)),
          ) as {
            token: string;
          };
          token = envelope.token;
        } catch (error) {
          await this.recordFailure(
            config.id,
            `Could not decrypt stored credentials: ${shortErrorMessage(error)}`,
            now,
          );
          return 0;
        }

        let devices: TraccarDevice[];
        let positions: TraccarPosition[];
        try {
          [devices, positions] = await Promise.all([
            this.traccar.getDevices(config.baseUrl, token),
            this.traccar.getPositions(config.baseUrl, token),
          ]);
        } catch (error) {
          await this.recordFailure(config.id, shortErrorMessage(error), now);
          return 0;
        }

        const written = await this.writeMatchedFixes(config.tenantId, devices, positions);
        await this.prisma.client.gpsProviderConfig.update({
          where: { id: config.id },
          // isActive is deliberately untouched here - only a failed poll
          // (recordFailure) or the explicit PATCH .../deactivate route
          // ever changes it.
          data: { lastPolledAt: now, lastSuccessAt: now },
        });
        return written;
      },
    );
  }

  private async recordFailure(configId: string, message: string, now: Date): Promise<void> {
    await this.prisma.client.gpsProviderConfig.update({
      where: { id: configId },
      data: { lastPolledAt: now, lastErrorMessage: message },
    });
  }

  /**
   * Matches each Traccar position's deviceId -> uniqueId (via the devices
   * call), then uniqueId -> Motorcycle.gpsDeviceId scoped to this tenant
   * (the Motorcycle query below runs inside pollTenantConfig's scoped
   * requestContext.run, so it's auto-tenant-scoped by the extension, same
   * as any other query in this codebase). A Traccar device with no
   * matching Motorcycle is skipped silently - pairing is a separate,
   * already-built dashboard action, not this poller's job.
   *
   * "Latest DEVICE fix per motorcycle, this tenant" is ONE groupBy query
   * regardless of how many motorcycles matched - not one query per
   * motorcycle - same batched-query discipline as
   * OwnershipPlanService.batchDerivedFigures / GpsService.recordPhoneFixes'
   * batched assignment lookup.
   */
  private async writeMatchedFixes(
    tenantId: string,
    devices: TraccarDevice[],
    positions: TraccarPosition[],
  ): Promise<number> {
    const uniqueIdByDeviceId = new Map(devices.map((d) => [d.id, d.uniqueId]));
    const uniqueIds = [...new Set(devices.map((d) => d.uniqueId))];
    if (uniqueIds.length === 0) {
      return 0;
    }

    const motorcycles = await this.prisma.client.motorcycle.findMany({
      where: { gpsDeviceId: { in: uniqueIds } },
      select: { id: true, gpsDeviceId: true },
    });
    const motorcycleIdByUniqueId = new Map(
      motorcycles
        .filter((m): m is { id: string; gpsDeviceId: string } => m.gpsDeviceId !== null)
        .map((m) => [m.gpsDeviceId, m.id]),
    );
    if (motorcycleIdByUniqueId.size === 0) {
      return 0;
    }

    const matched: { motorcycleId: string; position: TraccarPosition; recordedAt: Date }[] = [];
    for (const position of positions) {
      const uniqueId = uniqueIdByDeviceId.get(position.deviceId);
      const motorcycleId = uniqueId ? motorcycleIdByUniqueId.get(uniqueId) : undefined;
      if (!motorcycleId) {
        continue; // unmatched device - not an error, see comment above
      }
      const recordedAt = resolvePositionTimestamp(position);
      if (!recordedAt) {
        continue; // neither fixTime nor deviceTime parsed to a real date
      }
      matched.push({ motorcycleId, position, recordedAt });
    }
    if (matched.length === 0) {
      return 0;
    }

    const matchedMotorcycleIds = [...new Set(matched.map((m) => m.motorcycleId))];
    const latestFixes = await this.prisma.client.gpsLocation.groupBy({
      by: ['motorcycleId'],
      where: { motorcycleId: { in: matchedMotorcycleIds }, source: GpsSource.DEVICE },
      _max: { recordedAt: true },
    });
    const latestByMotorcycle = new Map(latestFixes.map((f) => [f.motorcycleId, f._max.recordedAt]));

    const rows: Prisma.GpsLocationCreateManyInput[] = [];
    for (const fix of matched) {
      const latest = latestByMotorcycle.get(fix.motorcycleId);
      if (latest && fix.recordedAt <= latest) {
        continue; // not newer than what we already have - nothing to write
      }
      rows.push({
        tenantId,
        motorcycleId: fix.motorcycleId,
        driverId: null,
        source: GpsSource.DEVICE,
        latitude: fix.position.latitude,
        longitude: fix.position.longitude,
        speedKmh: fix.position.speed * KNOTS_TO_KMH,
        heading: fix.position.course,
        accuracyMeters: fix.position.accuracy,
        batteryPercent: extractBatteryPercent(fix.position.attributes),
        recordedAt: fix.recordedAt,
      });
    }

    if (rows.length > 0) {
      await this.prisma.client.gpsLocation.createMany({ data: rows });
    }
    return rows.length;
  }
}
