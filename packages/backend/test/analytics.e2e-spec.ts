import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { ExpenseStatus, PaymentStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestContext } from '../src/common/context/request-context';
import { cleanDatabase, CLEAN_DATABASE_HOOK_TIMEOUT_MS } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';
import { signupAndActivateOwner } from './utils/verified-signup.util';

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function signupOwner(app: INestApplication, email: string, company: string) {
  const { accessToken } = await signupAndActivateOwner(app, {
    email,
    password: 'password123',
    companyName: company,
    firstName: 'Own',
    lastName: 'Er',
    phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
  });
  return accessToken;
}

async function setupFleet(app: INestApplication, token: string, tag: string) {
  const driverRes = await request(app.getHttpServer())
    .post('/drivers')
    .set('Authorization', `Bearer ${token}`)
    .send({
      firstName: 'Juma',
      lastName: tag,
      phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
      email: `driver-${tag.toLowerCase()}@test.local`,
      licenseNumber: `LIC-${tag}`,
      initialPassword: 'driverpass123',
    })
    .expect(201);
  const motoRes = await request(app.getHttpServer())
    .post('/motorcycles')
    .set('Authorization', `Bearer ${token}`)
    .send({ registrationNumber: `REG-${tag}` })
    .expect(201);
  return { driverId: driverRes.body.id as string, motorcycleId: motoRes.body.id as string };
}

/** Create an assignment and a COMPLETED payment for a past day, returning nothing. */
async function earn(
  app: INestApplication,
  token: string,
  driverId: string,
  motorcycleId: string,
  date: string,
  target: number,
  amount: number,
) {
  const assignmentRes = await request(app.getHttpServer())
    .post('/assignments')
    .set('Authorization', `Bearer ${token}`)
    .send({ driverId, motorcycleId, assignedDate: date, targetAmount: target })
    .expect(201);
  const paymentRes = await request(app.getHttpServer())
    .post('/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({ dailyAssignmentId: assignmentRes.body.id, driverId, amount })
    .expect(201);
  await request(app.getHttpServer())
    .patch(`/payments/${paymentRes.body.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: PaymentStatus.COMPLETED })
    .expect(200);
}

describe('Analytics & expenses (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = await createTestApp(moduleFixture);
    prisma = moduleFixture.get(PrismaService);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  }, CLEAN_DATABASE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  }, CLEAN_DATABASE_HOOK_TIMEOUT_MS);

  it('records expenses and reports a correct tenant-isolated P&L', async () => {
    const token = await signupOwner(app, 'owner-a@fleet-a.test', 'Fleet A');
    const { driverId, motorcycleId } = await setupFleet(app, token, 'A1');

    // Revenue: two completed payments totalling 15000.
    await earn(app, token, driverId, motorcycleId, isoDaysAgo(2), 10000, 10000);
    await earn(app, token, driverId, motorcycleId, isoDaysAgo(1), 10000, 5000);

    // Expenses: 3000 fuel + 2000 repairs, both attributed to the bike.
    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'Fuel', amount: 3000, incurredAt: isoDaysAgo(2), motorcycleId })
      .expect(201);
    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'Repairs', amount: 2000, incurredAt: isoDaysAgo(1), motorcycleId })
      .expect(201);

    // A maintenance log (2500) inserted directly - no maintenance API yet.
    const tenantId = await currentTenantId(prisma, 'owner-a@fleet-a.test');
    await requestContext.runUnscoped(() =>
      prisma.client.maintenanceLog.create({
        data: {
          tenantId,
          motorcycleId,
          description: 'Chain service',
          cost: 2500,
          performedAt: new Date(`${isoDaysAgo(1)}T00:00:00.000Z`),
        },
      }),
    );

    const pnl = await request(app.getHttpServer())
      .get('/analytics/pnl')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(pnl.body.revenue).toBe('15000.00');
    expect(pnl.body.expenses).toBe('7500.00'); // 3000 + 2000 + 2500 maintenance
    expect(pnl.body.netProfit).toBe('7500.00');
    expect(pnl.body.paymentCount).toBe(2);
    expect(pnl.body.expenseCount).toBe(3);

    const perMoto = await request(app.getHttpServer())
      .get('/analytics/per-motorcycle')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(perMoto.body).toHaveLength(1);
    expect(perMoto.body[0]).toMatchObject({
      registrationNumber: 'REG-A1',
      revenue: '15000.00',
      expenses: '7500.00',
      netProfit: '7500.00',
    });

    const perDriver = await request(app.getHttpServer())
      .get('/analytics/per-driver')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(perDriver.body).toHaveLength(1);
    expect(perDriver.body[0]).toMatchObject({ revenue: '15000.00', paymentCount: 2 });

    const breakdown = await request(app.getHttpServer())
      .get('/analytics/expense-breakdown')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(breakdown.body).toEqual([
      { category: 'Fuel', amount: '3000.00', count: 1 },
      { category: 'Maintenance', amount: '2500.00', count: 1 },
      { category: 'Repairs', amount: '2000.00', count: 1 },
    ]);
  });

  it('honours the date-range filter', async () => {
    const token = await signupOwner(app, 'owner-b@fleet-b.test', 'Fleet B');
    const { driverId, motorcycleId } = await setupFleet(app, token, 'B1');

    await earn(app, token, driverId, motorcycleId, isoDaysAgo(20), 10000, 8000); // outside window
    await earn(app, token, driverId, motorcycleId, isoDaysAgo(2), 10000, 6000); // inside window

    const pnl = await request(app.getHttpServer())
      .get('/analytics/pnl')
      .query({ from: isoDaysAgo(7), to: isoDaysAgo(0) })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(pnl.body.revenue).toBe('6000.00');
    expect(pnl.body.paymentCount).toBe(1);
  });

  // Stage H1 (DESIGN_RIDER_EXPENSES.md §3) - the load-bearing test for
  // COUNTED_EXPENSE. POST /expenses can't produce a PENDING row today (no
  // status field on the DTO, and every row defaults to APPROVED - see the
  // Expense model's own comment on why APPROVED, not PENDING, is the
  // default), so the PENDING expense is created directly via Prisma, same
  // as this file's existing maintenanceLog direct-create for "no API yet."
  // The APPROVED->APPROVED flip has no endpoint either (that's H2's approve
  // route) and is likewise done directly via Prisma.
  it('excludes a PENDING expense from P&L until it is approved', async () => {
    const token = await signupOwner(app, 'owner-e@fleet-e.test', 'Fleet E');
    const { driverId, motorcycleId } = await setupFleet(app, token, 'E1');
    const tenantId = await currentTenantId(prisma, 'owner-e@fleet-e.test');

    // Revenue: one completed payment of 20000.
    await earn(app, token, driverId, motorcycleId, isoDaysAgo(1), 20000, 20000);

    // Approved expense (via the real endpoint - defaults to APPROVED).
    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'Fuel', amount: 3000, incurredAt: isoDaysAgo(1), motorcycleId })
      .expect(201);

    // Pending expense of a DIFFERENT amount, created directly since no
    // endpoint can produce PENDING yet.
    const pending = await requestContext.runUnscoped(() =>
      prisma.client.expense.create({
        data: {
          tenantId,
          motorcycleId,
          category: 'Repairs',
          amount: 5000,
          incurredAt: new Date(`${isoDaysAgo(1)}T00:00:00.000Z`),
          status: ExpenseStatus.PENDING,
        },
      }),
    );

    const before = await request(app.getHttpServer())
      .get('/analytics/pnl')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // Only the 3000 APPROVED expense counts - the 5000 PENDING one must not
    // move this number at all, in either direction.
    expect(before.body.expenses).toBe('3000.00');
    expect(before.body.netProfit).toBe('17000.00'); // 20000 - 3000

    await requestContext.runUnscoped(() =>
      prisma.client.expense.update({
        where: { id: pending.id },
        data: { status: ExpenseStatus.APPROVED },
      }),
    );

    const after = await request(app.getHttpServer())
      .get('/analytics/pnl')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(after.body.expenses).toBe('8000.00'); // 3000 + 5000
    expect(after.body.netProfit).toBe('12000.00'); // 20000 - 8000
  });

  it('keeps each tenant to its own numbers and forbids drivers', async () => {
    const tokenA = await signupOwner(app, 'owner-c@fleet-c.test', 'Fleet C');
    const fleetA = await setupFleet(app, tokenA, 'C1');
    await earn(app, tokenA, fleetA.driverId, fleetA.motorcycleId, isoDaysAgo(1), 10000, 10000);

    const tokenB = await signupOwner(app, 'owner-d@fleet-d.test', 'Fleet D');

    // Tenant B sees zero of tenant A's revenue.
    const pnlB = await request(app.getHttpServer())
      .get('/analytics/pnl')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(pnlB.body.revenue).toBe('0.00');

    // A driver is forbidden from analytics.
    const driverLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'driver-c1@test.local', password: 'driverpass123' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/analytics/pnl')
      .set('Authorization', `Bearer ${driverLogin.body.accessToken}`)
      .expect(403);
  });

  // Stage UI3 - the Payments closing row's "Collection rate" chart, reusing
  // the exact same getDailyCollectionSeries the Operations Center already
  // charts, now over a caller-supplied range instead of a fixed 14 days.
  it('collection-series returns one point per day in range, gaps included', async () => {
    const token = await signupOwner(app, 'owner-f@fleet-f.test', 'Fleet F');
    const { driverId, motorcycleId } = await setupFleet(app, token, 'F1');

    await earn(app, token, driverId, motorcycleId, isoDaysAgo(2), 10000, 7000);
    // isoDaysAgo(1) deliberately left with no payment - must appear as a
    // zero-amount point, not be skipped.

    const res = await request(app.getHttpServer())
      .get('/analytics/collection-series')
      .query({ from: isoDaysAgo(2), to: isoDaysAgo(0) })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveLength(3);
    expect(res.body[0]).toEqual({ date: isoDaysAgo(2), amount: '7000.00' });
    expect(res.body[1]).toEqual({ date: isoDaysAgo(1), amount: '0.00' });
    expect(res.body[2]).toEqual({ date: isoDaysAgo(0), amount: '0.00' });
  });

  it('rejects collection-series with no from/to (unlike /pnl, which treats it as all-time)', async () => {
    const token = await signupOwner(app, 'owner-g@fleet-g.test', 'Fleet G');
    await request(app.getHttpServer())
      .get('/analytics/collection-series')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  // Stage UI3 - Reports' "Profit and loss by segment" table: a real
  // vehicleCount (fleet composition) alongside revenue/expenses reused
  // from /pnl per type, plus a totals row that is its own server
  // computation, not a client-side sum of the rows above.
  it('pnl-by-segment reports vehicleCount, revenue/expenses/netProfit, and a real totals row per vehicle type', async () => {
    const token = await signupOwner(app, 'owner-h@fleet-h.test', 'Fleet H');
    const { driverId, motorcycleId: bikeId } = await setupFleet(app, token, 'H1');
    const truckRes = await request(app.getHttpServer())
      .post('/motorcycles')
      .set('Authorization', `Bearer ${token}`)
      .send({ registrationNumber: 'REG-H2', vehicleType: 'TRUCK' })
      .expect(201);
    const truckId = truckRes.body.id as string;

    // Bike: 10000 rental revenue, 2000 expense.
    await earn(app, token, driverId, bikeId, isoDaysAgo(1), 10000, 10000);
    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'Fuel', amount: 2000, incurredAt: isoDaysAgo(1), motorcycleId: bikeId })
      .expect(201);

    // Truck: a transport job worth 50000, no expenses.
    await request(app.getHttpServer())
      .post('/transport-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        motorcycleId: truckId,
        ownerDriven: true,
        origin: 'Dar',
        destination: 'Arusha',
        revenue: 50000,
        scheduledDate: isoDaysAgo(1),
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/analytics/pnl-by-segment')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const motorbike = res.body.find((r: { vehicleType: string }) => r.vehicleType === 'MOTORBIKE');
    expect(motorbike).toMatchObject({
      vehicleCount: 1,
      revenue: '10000.00',
      expenses: '2000.00',
      netProfit: '8000.00',
      netProfitPerVehicle: '8000.00',
      marginPct: 80,
    });

    const truck = res.body.find((r: { vehicleType: string }) => r.vehicleType === 'TRUCK');
    expect(truck).toMatchObject({
      vehicleCount: 1,
      revenue: '50000.00',
      expenses: '0.00',
      netProfit: '50000.00',
    });

    const total = res.body.find((r: { vehicleType: string }) => r.vehicleType === 'TOTAL');
    expect(total).toMatchObject({
      vehicleCount: 2,
      revenue: '60000.00',
      expenses: '2000.00',
      netProfit: '58000.00',
    });
  });

  // Stage UI3 - Reports' "Revenue and profit by month" table.
  it('monthly-pnl-series buckets revenue and expenses by calendar month', async () => {
    const token = await signupOwner(app, 'owner-i@fleet-i.test', 'Fleet I');
    const { driverId, motorcycleId } = await setupFleet(app, token, 'I1');

    await earn(app, token, driverId, motorcycleId, isoDaysAgo(1), 8000, 8000);
    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'Fuel', amount: 1500, incurredAt: isoDaysAgo(1), motorcycleId })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/analytics/monthly-pnl-series')
      .query({ monthsBack: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const thisMonth = new Date().toISOString().slice(0, 7);
    expect(res.body).toEqual([
      { month: thisMonth, revenue: '8000.00', expenses: '1500.00', netProfit: '6500.00' },
    ]);
  });
});

async function currentTenantId(prisma: PrismaService, ownerEmail: string): Promise<string> {
  return requestContext.runUnscoped(async () => {
    const user = await prisma.client.user.findFirst({ where: { email: ownerEmail } });
    return user!.tenantId;
  });
}
