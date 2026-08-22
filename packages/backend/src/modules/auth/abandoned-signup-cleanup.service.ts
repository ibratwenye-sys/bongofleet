import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { TenantStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { requestContext } from '../../common/context/request-context';

export const ABANDONED_SIGNUP_CLEANUP_CRON_JOB = 'abandoned-signup-cleanup';

export interface AbandonedSignupCleanupResult {
  tenantsDeleted: number;
}

/**
 * Stage S1 Part 4. POST /auth/signup has no limit (Stage S1's WHY), so a
 * PENDING_VERIFICATION tenant that never verifies is dead weight that only
 * ever accumulates unless something sweeps it. A tenant stuck
 * PENDING_VERIFICATION can own nothing else - the tenant-lock guard
 * (tenant-lock.util.ts, enforced in JwtAuthGuard) refuses it on every
 * authenticated route except a handful it can't do anything harmful with, so
 * there is never a driver, motorcycle, or payment hanging off one of these:
 * only the tenant row and the one owner User row signup created.
 *
 * ABANDONED_SIGNUP_RETENTION_DAYS is a config value separate from
 * TENANT_TRIAL_DAYS on purpose - see env.validation.ts's comment. They
 * answer unrelated questions and must be free to move independently.
 */
@Injectable()
export class AbandonedSignupCleanupService implements OnModuleInit {
  private readonly logger = new Logger(AbandonedSignupCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    // Never self-schedule inside tests - specs call cleanup() directly.
    if (this.config.get<string>('NODE_ENV') === 'test') {
      return;
    }

    const expression = this.config.get<string>('ABANDONED_SIGNUP_CLEANUP_CRON', '30 3 * * *');
    const timeZone = this.config.get<string>('DOCUMENT_EXPIRY_TZ', 'Africa/Dar_es_Salaam');

    const job = new CronJob(
      expression,
      () => {
        this.cleanup().catch((error: unknown) => {
          this.logger.error(
            'Scheduled abandoned-signup cleanup failed',
            error instanceof Error ? error.stack : String(error),
          );
        });
      },
      null,
      false,
      timeZone,
    );

    this.schedulerRegistry.addCronJob(ABANDONED_SIGNUP_CLEANUP_CRON_JOB, job);
    job.start();
    this.logger.log(`Abandoned-signup cleanup scheduled: "${expression}" (${timeZone})`);
  }

  async cleanup(now: Date = new Date()): Promise<AbandonedSignupCleanupResult> {
    const retentionDays = this.config.get<number>('ABANDONED_SIGNUP_RETENTION_DAYS', 7);
    const cutoff = new Date(now);
    cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);

    const abandoned = await requestContext.runUnscoped(() =>
      this.prisma.client.tenant.findMany({
        where: { status: TenantStatus.PENDING_VERIFICATION, createdAt: { lt: cutoff } },
        select: { id: true, name: true },
      }),
    );

    for (const tenant of abandoned) {
      try {
        // Data is never deleted for a real tenant - see tenant-lock.util.ts.
        // This is the one exception, and it isn't one: a signup that never
        // verified never became a real tenant. Only the tenant row and its
        // one owner User exist for one of these (see class doc comment), so
        // the user delete first, then the tenant, is the whole cleanup.
        await requestContext.runUnscoped(() =>
          this.prisma.client.$transaction(async (tx) => {
            await tx.user.deleteMany({ where: { tenantId: tenant.id } });
            await tx.tenant.delete({ where: { id: tenant.id } });
          }),
        );
      } catch (error) {
        this.logger.error(
          `Abandoned-signup cleanup failed for tenant ${tenant.id} (${tenant.name}) - continuing`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    if (abandoned.length > 0) {
      this.logger.log(`Abandoned-signup cleanup: removed ${abandoned.length} unverified tenant(s)`);
    }

    return { tenantsDeleted: abandoned.length };
  }
}
