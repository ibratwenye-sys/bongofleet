/**
 * Idempotent dev seed: ensures the owner login exists (owner@bongofleet.com /
 * Test1234!) plus a little demo data so the dashboard - especially Reports -
 * has something to show. Safe to run repeatedly: if the owner already exists,
 * it does nothing.
 *
 * Run with:  pnpm --filter @bongofleet/backend seed
 * Targets whatever DATABASE_URL points at (your dev database), NOT the test DB.
 */
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../src/modules/auth/utils/password.util';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const OWNER_EMAIL = 'owner@bongofleet.com';
const OWNER_PASSWORD = 'Test1234!';

function dateOnly(daysAgo: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set - cannot seed.');
  }
  if (new URL(connectionString).pathname.replace(/^\//, '').endsWith('_test')) {
    throw new Error('DATABASE_URL points at a *_test database - refusing to seed test data there.');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const existing = await prisma.user.findFirst({ where: { email: OWNER_EMAIL } });
    if (existing) {
      // eslint-disable-next-line no-console
      console.log(`Owner ${OWNER_EMAIL} already exists - nothing to seed.`);
      return;
    }

    const passwordHash = await hashPassword(OWNER_PASSWORD);

    const tenant = await prisma.tenant.create({ data: { name: 'My Fleet' } });

    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: OWNER_EMAIL,
        phone: '+255700000000',
        passwordHash,
        role: 'OWNER',
        firstName: 'Ibrahim',
        lastName: 'Owner',
      },
    });

    // A rider (login + profile), a motorcycle, one assignment paid in full, an
    // expense, and a maintenance log - enough for Reports to show real numbers.
    const riderUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: 'rider1@bongofleet.com',
        phone: '+255700000001',
        passwordHash: await hashPassword('Rider1234!'),
        role: 'RIDER',
        firstName: 'Juma',
        lastName: 'Rider',
      },
    });
    const rider = await prisma.rider.create({
      data: { tenantId: tenant.id, userId: riderUser.id, licenseNumber: 'LIC-DEMO-1' },
    });
    const motorcycle = await prisma.motorcycle.create({
      data: { tenantId: tenant.id, registrationNumber: 'T123 ABC', currentMileage: 8000 },
    });
    const assignment = await prisma.dailyAssignment.create({
      data: {
        tenantId: tenant.id,
        riderId: rider.id,
        motorcycleId: motorcycle.id,
        assignedDate: dateOnly(1),
        targetAmount: 15000,
      },
    });
    await prisma.dailyPayment.create({
      data: {
        tenantId: tenant.id,
        dailyAssignmentId: assignment.id,
        riderId: rider.id,
        amount: 15000,
        status: 'COMPLETED',
        paidAt: new Date(),
      },
    });
    await prisma.expense.create({
      data: {
        tenantId: tenant.id,
        motorcycleId: motorcycle.id,
        category: 'Fuel',
        amount: 4000,
        incurredAt: dateOnly(1),
      },
    });
    await prisma.maintenanceLog.create({
      data: {
        tenantId: tenant.id,
        motorcycleId: motorcycle.id,
        description: 'Oil change',
        cost: 12000,
        performedAt: dateOnly(1),
        mileageAtService: 8000,
        nextServiceDate: dateOnly(-30),
        nextServiceMileage: 11000,
      },
    });

    // eslint-disable-next-line no-console
    console.log(`Seeded owner ${OWNER_EMAIL} (password ${OWNER_PASSWORD}) + demo fleet data.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
