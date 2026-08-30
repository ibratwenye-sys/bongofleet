/**
 * Idempotent dev seed: ensures the owner login exists (owner@bongofleet.com /
 * Test1234!) plus a little demo data so the dashboard - especially Reports -
 * has something to show, PLUS (Stage G6) an ownership-plan showcase: three
 * plans in visibly different states, so a reviewer can see the streak/
 * excusal work on screen without building any data by hand.
 *
 * Safe to run repeatedly - each section has its own guard, checked
 * independently, so re-running after the owner already exists still fills in
 * the ownership-plan showcase if that part hasn't run yet (and does nothing
 * if it has).
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

// Stage G6 - obviously-fake sample values only, per Ibrahim's own
// instruction. Never a real-shaped NIDA, phone, or account number.
const PLACEHOLDER_NATIONAL_ID = '00000000-00000-00000-00';

function dateOnly(daysAgo: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function seedOwnerAndBasicDemoData(
  prisma: PrismaClient,
): Promise<{ tenantId: string; ownerUserId: string }> {
  const existingOwner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL } });
  if (existingOwner) {
    // eslint-disable-next-line no-console
    console.log(`Owner ${OWNER_EMAIL} already exists - reusing tenant ${existingOwner.tenantId}.`);
    return { tenantId: existingOwner.tenantId, ownerUserId: existingOwner.id };
  }

  const passwordHash = await hashPassword(OWNER_PASSWORD);

  const tenant = await prisma.tenant.create({ data: { name: 'My Fleet' } });

  const owner = await prisma.user.create({
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

  // A driver (login + profile), a motorcycle, one assignment paid in full, an
  // expense, and a maintenance log - enough for Reports to show real numbers.
  const driverUser = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'driver1@bongofleet.com',
      phone: '+255700000001',
      passwordHash: await hashPassword('Driver1234!'),
      role: 'RIDER',
      firstName: 'Juma',
      lastName: 'Driver',
    },
  });
  const driver = await prisma.driver.create({
    data: { tenantId: tenant.id, userId: driverUser.id, licenseNumber: 'LIC-DEMO-1' },
  });
  const motorcycle = await prisma.motorcycle.create({
    data: { tenantId: tenant.id, registrationNumber: 'T123 ABC', currentMileage: 8000 },
  });
  const assignment = await prisma.dailyAssignment.create({
    data: {
      tenantId: tenant.id,
      driverId: driver.id,
      motorcycleId: motorcycle.id,
      assignedDate: dateOnly(1),
      targetAmount: 15000,
    },
  });
  await prisma.dailyPayment.create({
    data: {
      tenantId: tenant.id,
      dailyAssignmentId: assignment.id,
      driverId: driver.id,
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
  return { tenantId: tenant.id, ownerUserId: owner.id };
}

async function seedDriverAndVehicle(
  prisma: PrismaClient,
  tenantId: string,
  tag: string,
  firstName: string,
  lastName: string,
  phoneSuffix: string,
  registration: string,
) {
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `driver-${tag}@bongofleet.com`,
      phone: `+25570000${phoneSuffix}`,
      passwordHash: await hashPassword('Driver1234!'),
      role: 'RIDER',
      firstName,
      lastName,
    },
  });
  const driver = await prisma.driver.create({
    data: {
      tenantId,
      userId: user.id,
      licenseNumber: `LIC-DEMO-${tag.toUpperCase()}`,
      nationalId: PLACEHOLDER_NATIONAL_ID,
    },
  });
  const motorcycle = await prisma.motorcycle.create({
    data: { tenantId, registrationNumber: registration, currentMileage: 5000 },
  });
  return { driver, motorcycle };
}

/**
 * Stage G6 Part 2 - three ownership plans in visibly different states, so
 * the streak/excusal work (Stage G-G5) is something a reviewer can actually
 * look at instead of imagining from the diff:
 *
 *   - Amina: healthy and ahead (green "On track"/"ahead", no streak).
 *   - Baraka: a few days behind, past this plan's own grace period but well
 *     short of breach (amber, not red).
 *   - Charles: a missed streak past the breach threshold (red) - WITH an
 *     APPROVED excusal in the middle of that run, so the ledger visibly
 *     shows one excused day inside an otherwise-unexcused streak, and the
 *     streak still reads as breached even so (an excusal is transparent to
 *     the count, not a subtraction from it - see
 *     computeConsecutiveMissedDays).
 *
 * Guarded on Amina's motorcycle registration existing - if this has already
 * run for this tenant, does nothing.
 */
async function seedOwnershipPlanShowcase(
  prisma: PrismaClient,
  tenantId: string,
  ownerUserId: string,
): Promise<void> {
  const already = await prisma.motorcycle.findFirst({
    where: { tenantId, registrationNumber: 'DEMO-OWN-A' },
  });
  if (already) {
    // eslint-disable-next-line no-console
    console.log('Ownership-plan showcase already seeded for this tenant - nothing to do.');
    return;
  }

  const DAILY_AMOUNT = 12000;
  const TOTAL_PRICE = 1_800_000;

  async function createPlan(
    driverId: string,
    motorcycleId: string,
    graceDays: number,
    startDate: Date,
  ) {
    return prisma.ownershipPlan.create({
      data: {
        tenantId,
        driverId,
        motorcycleId,
        dailyAmount: DAILY_AMOUNT,
        // Stage G7 - matches TOTAL_PRICE / DAILY_AMOUNT exactly (1,800,000 /
        // 12,000 = 150); totalOwed is dailyAmount x instalmentCount now, not
        // derived from totalPrice/downPayment.
        instalmentCount: 150,
        totalPrice: TOTAL_PRICE,
        downPayment: 0,
        startDate,
        activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
        graceDays,
        breachAfterConsecutiveMissedDays: 5,
      },
    });
  }

  async function createAssignment(
    driverId: string,
    motorcycleId: string,
    planId: string,
    daysAgo: number,
  ) {
    return prisma.dailyAssignment.create({
      data: {
        tenantId,
        driverId,
        motorcycleId,
        ownershipPlanId: planId,
        assignedDate: dateOnly(daysAgo),
        targetAmount: DAILY_AMOUNT,
      },
    });
  }

  async function payInFull(driverId: string, assignmentId: string, amount = DAILY_AMOUNT) {
    return prisma.dailyPayment.create({
      data: {
        tenantId,
        dailyAssignmentId: assignmentId,
        driverId,
        amount,
        status: 'COMPLETED',
        paidAt: new Date(),
      },
    });
  }

  // --- Amina: healthy and ahead (10 days assigned, all paid, one extra day
  // paid on top -> 1 day ahead, no missed streak) ---
  const amina = await seedDriverAndVehicle(
    prisma,
    tenantId,
    'a',
    'Amina',
    'Hassan',
    '010',
    'DEMO-OWN-A',
  );
  const planA = await createPlan(amina.driver.id, amina.motorcycle.id, 2, dateOnly(15));
  for (let daysAgo = 10; daysAgo >= 1; daysAgo -= 1) {
    const assignment = await createAssignment(
      amina.driver.id,
      amina.motorcycle.id,
      planA.id,
      daysAgo,
    );
    await payInFull(amina.driver.id, assignment.id);
    if (daysAgo === 1) {
      // The surplus that puts her a day ahead.
      await payInFull(amina.driver.id, assignment.id);
    }
  }

  // --- Baraka: a few days behind, past this plan's own grace (1 day) but
  // nowhere near breach (3 days missed, threshold is 5) ---
  const baraka = await seedDriverAndVehicle(
    prisma,
    tenantId,
    'b',
    'Baraka',
    'Mwangi',
    '011',
    'DEMO-OWN-B',
  );
  const planB = await createPlan(baraka.driver.id, baraka.motorcycle.id, 1, dateOnly(15));
  for (let daysAgo = 10; daysAgo >= 1; daysAgo -= 1) {
    const assignment = await createAssignment(
      baraka.driver.id,
      baraka.motorcycle.id,
      planB.id,
      daysAgo,
    );
    if (daysAgo > 3) {
      await payInFull(baraka.driver.id, assignment.id);
    }
    // daysAgo 3, 2, 1 (yesterday) left unpaid - a 3-day streak.
  }

  // --- Charles: a missed streak past breach (5), with day -4 excused in the
  // middle of it. The excusal is transparent, not subtracted - the streak
  // still reads 7 (offsets -8..-1 minus the excused -4), still >= 5, still
  // red - while the ledger visibly shows the one excused day inside it. ---
  const charles = await seedDriverAndVehicle(
    prisma,
    tenantId,
    'c',
    'Charles',
    'Ndege',
    '012',
    'DEMO-OWN-C',
  );
  const planC = await createPlan(charles.driver.id, charles.motorcycle.id, 2, dateOnly(15));
  let excusedAssignmentDate: Date | null = null;
  for (let daysAgo = 8; daysAgo >= 1; daysAgo -= 1) {
    await createAssignment(charles.driver.id, charles.motorcycle.id, planC.id, daysAgo);
    if (daysAgo === 4) {
      excusedAssignmentDate = dateOnly(daysAgo);
    }
    // Every day left unpaid - the whole run is missed except the excused one.
  }
  if (excusedAssignmentDate) {
    await prisma.dayExcusal.create({
      data: {
        tenantId,
        ownershipPlanId: planC.id,
        excusedDate: excusedAssignmentDate,
        reason:
          'Msiba wa jamaa - alimjulisha msimamizi wake (family bereavement - told his supervisor)',
        status: 'APPROVED',
        decidedByUserId: ownerUserId,
        decidedAt: new Date(),
      },
    });
  }

  // --- A placeholder payment account, so the contract/payment-account UI
  // has something obviously-fake to show rather than nothing. ---
  await prisma.paymentAccount.create({
    data: {
      tenantId,
      kind: 'BANK',
      provider: 'Demo Bank',
      accountNumber: '0000000000',
      accountName: 'Demo Fleet Ltd',
      isActive: true,
      sortOrder: 0,
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    'Seeded ownership-plan showcase: Amina (ahead), Baraka (behind, amber), ' +
      'Charles (breached, red, with one excused day mid-run).',
  );
}

/**
 * Stage UI-FIX2 - a minimal, reproducible TransportPage fixture. Every
 * other mobile-card e2e hop (Fleet, Drivers, Assignments) anchors on a
 * real seed.ts fixture that survives a fresh reseed; Transport had none,
 * so its own e2e coverage had to fall back to live dev-DB data. This is
 * the smoke-test-sized fix - one vehicle, one completed trip, one
 * expense - not a second full showcase like seedOwnershipPlanShowcase.
 *
 * Guarded on DEMO-TRN-A already existing, same convention as
 * seedOwnershipPlanShowcase's DEMO-OWN-A guard.
 */
async function seedTransportShowcase(prisma: PrismaClient, tenantId: string): Promise<void> {
  const already = await prisma.motorcycle.findFirst({
    where: { tenantId, registrationNumber: 'DEMO-TRN-A' },
  });
  if (already) {
    // eslint-disable-next-line no-console
    console.log('Transport showcase already seeded for this tenant - nothing to do.');
    return;
  }

  const truck = await prisma.motorcycle.create({
    data: {
      tenantId,
      registrationNumber: 'DEMO-TRN-A',
      vehicleType: 'TRUCK',
      currentMileage: 20000,
    },
  });

  const scheduledDate = dateOnly(1);
  const job = await prisma.transportJob.create({
    data: {
      tenantId,
      motorcycleId: truck.id,
      ownerDriven: true,
      reference: 'BF-DEMO-TRN-A',
      origin: 'DAR ES SALAAM',
      destination: 'ARUSHA',
      revenue: 800000,
      status: 'DELIVERED',
      scheduledDate,
      pickedUpAt: scheduledDate,
      deliveredAt: scheduledDate,
    },
  });

  // A modest fuel expense against the job - real cost/profit numbers
  // instead of a zero-cost trip, same reasoning as
  // seedOwnerAndBasicDemoData's own "enough for Reports to show real
  // numbers."
  await prisma.expense.create({
    data: {
      tenantId,
      motorcycleId: truck.id,
      transportJobId: job.id,
      category: 'Fuel',
      amount: 120000,
      incurredAt: scheduledDate,
    },
  });

  // eslint-disable-next-line no-console
  console.log('Seeded transport showcase: DEMO-TRN-A, one delivered trip with a fuel expense.');
}

/**
 * Stage UI4f - a minimal, reproducible MaintenancePage fixture, same
 * reasoning as seedTransportShowcase (UI-FIX2): without it, "Needs
 * booking" and "Completed this month" had nothing but stale or non-
 * seeded live-DB data to anchor mobile-card e2e coverage on.
 *
 * One vehicle, one MaintenanceLog that does double duty: performedAt is
 * recent enough to land in "Completed this month" (and the default
 * "Manage older records" range), and its own nextServiceDate is already
 * in the past, so the same vehicle also shows up as OVERDUE in "Needs
 * booking" - the minimum needed to exercise all three tables, not a
 * fully realistic service-history timeline.
 *
 * Guarded on DEMO-MNT-A already existing, same convention as the other
 * showcase seeders.
 */
async function seedMaintenanceShowcase(prisma: PrismaClient, tenantId: string): Promise<void> {
  const already = await prisma.motorcycle.findFirst({
    where: { tenantId, registrationNumber: 'DEMO-MNT-A' },
  });
  if (already) {
    // eslint-disable-next-line no-console
    console.log('Maintenance showcase already seeded for this tenant - nothing to do.');
    return;
  }

  const vehicle = await prisma.motorcycle.create({
    data: {
      tenantId,
      registrationNumber: 'DEMO-MNT-A',
      currentMileage: 10000,
    },
  });

  await prisma.maintenanceLog.create({
    data: {
      tenantId,
      motorcycleId: vehicle.id,
      description: 'Oil change',
      cost: 15000,
      performedAt: dateOnly(1),
      mileageAtService: 10000,
      nextServiceDate: dateOnly(3),
    },
  });

  // eslint-disable-next-line no-console
  console.log('Seeded maintenance showcase: DEMO-MNT-A, one overdue completed service.');
}

/**
 * Stage UI4j - a minimal, reproducible ApprovalsPage fixture, same
 * reasoning as seedTransportShowcase/seedMaintenanceShowcase (UI-FIX2/
 * UI4f). Neither existing Expense fixture (seedOwnerAndBasicDemoData's
 * Fuel/4000, seedTransportShowcase's Fuel/120000) sets status, so both
 * default to APPROVED (schema.prisma) - /expenses?status=PENDING, this
 * page's entire data source, returns zero rows against a fresh reseed
 * without this. One driver/vehicle pair, one PENDING expense - no
 * receipt fields set, since a real file-upload fixture is out of scope
 * for a smoke-test-sized seed, same reasoning UI-FIX2 gave for not
 * building a full showcase.
 *
 * Guarded on DEMO-APR-A already existing, same convention as the other
 * showcase seeders.
 */
async function seedApprovalsShowcase(prisma: PrismaClient, tenantId: string): Promise<void> {
  const already = await prisma.motorcycle.findFirst({
    where: { tenantId, registrationNumber: 'DEMO-APR-A' },
  });
  if (already) {
    // eslint-disable-next-line no-console
    console.log('Approvals showcase already seeded for this tenant - nothing to do.');
    return;
  }

  const { driver, motorcycle } = await seedDriverAndVehicle(
    prisma,
    tenantId,
    'apr',
    'Fatuma',
    'Rajabu',
    '013',
    'DEMO-APR-A',
  );

  await prisma.expense.create({
    data: {
      tenantId,
      motorcycleId: motorcycle.id,
      submittedByRiderId: driver.id,
      category: 'Repairs',
      amount: 45000,
      incurredAt: dateOnly(1),
      status: 'PENDING',
    },
  });

  // eslint-disable-next-line no-console
  console.log('Seeded approvals showcase: DEMO-APR-A, one pending expense claim.');
}

/**
 * Stage DM5 - guarantees the RIDER ownership-plan showcase (Amina, from
 * seedOwnershipPlanShowcase) always has a live, unpaid DailyAssignment for
 * TODAY's calendar date, regardless of when this script happens to run
 * relative to OwnershipPlanGeneratorService's own nightly cron (5 0 * * *
 * Africa/Dar_es_Salaam, registered via SchedulerRegistry in that service's
 * onModuleInit - it does NOT run on module init, only on its own schedule).
 * Without this, the driver app's Leo screen can show "No assignment for
 * today yet." purely because of that timing gap - nothing actually broken,
 * just an unhelpful demo state.
 *
 * Deliberately NOT gated behind seedOwnershipPlanShowcase's own DEMO-OWN-A
 * guard, since that guard short-circuits on every run after the first - but
 * "today" moves every day, so this needs its own check and must run (and
 * safely no-op once today's row already exists) on every invocation.
 *
 * Left UNPAID on purpose - it demonstrates the "pay today" flow rather than
 * a fait accompli, same reasoning seedApprovalsShowcase gives for leaving
 * its own fixture PENDING rather than pre-resolved.
 */
async function seedTodaysLiveAssignment(prisma: PrismaClient, tenantId: string): Promise<void> {
  const aminaUser = await prisma.user.findFirst({
    where: { tenantId, email: 'driver-a@bongofleet.com' },
    include: { driverProfile: true },
  });
  const driver = aminaUser?.driverProfile;
  if (!driver) {
    // eslint-disable-next-line no-console
    console.log(
      "Skipping today's live assignment: Amina (driver-a@bongofleet.com) isn't seeded yet.",
    );
    return;
  }

  const motorcycle = await prisma.motorcycle.findFirst({
    where: { tenantId, registrationNumber: 'DEMO-OWN-A' },
  });
  if (!motorcycle) {
    // eslint-disable-next-line no-console
    console.log("Skipping today's live assignment: DEMO-OWN-A isn't seeded yet.");
    return;
  }

  const plan = await prisma.ownershipPlan.findFirst({ where: { driverId: driver.id } });
  if (!plan) {
    // eslint-disable-next-line no-console
    console.log("Skipping today's live assignment: Amina has no ownership plan yet.");
    return;
  }

  const today = dateOnly(0);
  const existing = await prisma.dailyAssignment.findFirst({
    where: { driverId: driver.id, assignedDate: today },
  });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(
      `Amina already has a daily assignment for ${today.toISOString().slice(0, 10)} - nothing to do.`,
    );
    return;
  }

  await prisma.dailyAssignment.create({
    data: {
      tenantId,
      driverId: driver.id,
      motorcycleId: motorcycle.id,
      ownershipPlanId: plan.id,
      assignedDate: today,
      targetAmount: plan.dailyAmount,
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    `Seeded a live, unpaid daily assignment for Amina Hassan on ${today.toISOString().slice(0, 10)}.`,
  );
}

/**
 * Stage DM5 - a truck-driver demo account. Before this, no seeded Driver
 * anywhere had driverType TRUCK_DRIVER or CAR_DRIVER (seedTransportShowcase's
 * one TransportJob is ownerDriven: true with driverId null), so the driver
 * app's truck/car tab bar (wired in DriverModeGate.tsx - Safari/Matumizi/
 * Mimi) has never had a real account to view it with.
 *
 * John Mwakalinga is the canonical truck-driver character per the prompt
 * that named this stage; I could not find claude/DESIGN_CANONICAL_DEMO_DATA.md
 * anywhere in this repo to cross-check that cast-list claim against, so the
 * name/reference/cargo/route/revenue values below are taken as given rather
 * than independently verified against a source document.
 *
 * Guarded on its own registration number, same convention as the other
 * showcase seeders.
 */
async function seedTruckDriverShowcase(prisma: PrismaClient, tenantId: string): Promise<void> {
  const already = await prisma.motorcycle.findFirst({
    where: { tenantId, registrationNumber: 'T 908 ZAP' },
  });
  if (already) {
    // eslint-disable-next-line no-console
    console.log('Truck-driver showcase already seeded for this tenant - nothing to do.');
    return;
  }

  const user = await prisma.user.create({
    data: {
      tenantId,
      email: 'driver-mwakalinga@bongofleet.com',
      phone: '+255700000014',
      passwordHash: await hashPassword('Driver1234!'),
      role: 'RIDER',
      firstName: 'John',
      lastName: 'Mwakalinga',
    },
  });
  const driver = await prisma.driver.create({
    data: {
      tenantId,
      userId: user.id,
      licenseNumber: 'LIC-DEMO-MWAKALINGA',
      driverType: 'TRUCK_DRIVER',
      nationalId: PLACEHOLDER_NATIONAL_ID,
    },
  });
  const truck = await prisma.motorcycle.create({
    data: {
      tenantId,
      registrationNumber: 'T 908 ZAP',
      vehicleType: 'TRUCK',
      currentMileage: 20000,
    },
  });

  const today = dateOnly(0);
  await prisma.transportJob.create({
    data: {
      tenantId,
      motorcycleId: truck.id,
      driverId: driver.id,
      ownerDriven: false,
      reference: 'BF-7QK2M91X',
      origin: 'DAR ES SALAAM',
      destination: 'MOROGORO',
      cargo: '8 tonnes of cement',
      revenue: 450000,
      status: 'IN_TRANSIT',
      scheduledDate: today,
      pickedUpAt: today,
      deliveredAt: null,
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    'Seeded truck-driver showcase: John Mwakalinga (driver-mwakalinga@bongofleet.com) driving T 908 ZAP, job BF-7QK2M91X to Morogoro.',
  );
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
    const { tenantId, ownerUserId } = await seedOwnerAndBasicDemoData(prisma);
    await seedOwnershipPlanShowcase(prisma, tenantId, ownerUserId);
    await seedTodaysLiveAssignment(prisma, tenantId);
    await seedTransportShowcase(prisma, tenantId);
    await seedMaintenanceShowcase(prisma, tenantId);
    await seedApprovalsShowcase(prisma, tenantId);
    await seedTruckDriverShowcase(prisma, tenantId);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
