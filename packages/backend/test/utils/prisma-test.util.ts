import { PrismaService } from '../../src/prisma/prisma.service';
import { requestContext } from '../../src/common/context/request-context';

const TABLES_FK_SAFE_ORDER = [
  'maintenance_reminders',
  'assignment_alerts',
  'document_alerts',
  'gps_locations',
  'daily_payments',
  'daily_assignments',
  'maintenance_logs',
  'expenses',
  'documents',
  'guarantors',
  'riders',
  'motorcycles',
  'users',
  'tenants',
];

export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await requestContext.runUnscoped(async () => {
    // Hard safety net: this helper TRUNCATEs every table, so refuse to run
    // unless we're connected to a dedicated *_test database. This makes it
    // impossible for a mis-pointed test run to wipe real dev/prod data, even if
    // DATABASE_URL is set wrong.
    const rows = await prisma.client.$queryRawUnsafe<Array<{ db: string }>>(
      'SELECT current_database() AS db',
    );
    const currentDb = rows[0]?.db ?? '';
    if (!/(^|_)test$/i.test(currentDb) && !/test/i.test(currentDb)) {
      throw new Error(
        `cleanDatabase() refused to truncate database "${currentDb}": e2e tests must run ` +
          'against a *_test database (set TEST_DATABASE_URL or let it derive <db>_test).',
      );
    }

    for (const table of TABLES_FK_SAFE_ORDER) {
      await prisma.client.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
    }
  });
}
