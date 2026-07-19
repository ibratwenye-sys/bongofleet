import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PaymentStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestContext } from '../src/common/context/request-context';
import { cleanDatabase } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function signupOwner(app: INestApplication, email: string, company: string) {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({
      email,
      password: 'password123',
      companyName: company,
      firstName: 'Own',
      lastName: 'Er',
      phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
    })
    .expect(201);
  return res.body.accessToken as string;
}

async function setupFleet(app: INestApplication, token: string, tag: string) {
  const riderRes = await request(app.getHttpServer())
    .post('/riders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      firstName: 'Juma',
      lastName: tag,
      phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
      email: `rider-${tag.toLowerCase()}@test.local`,
      licenseNumber: `LIC-${tag}`,
      initialPassword: 'riderpass123',
    })
    .expect(201);
  const motoRes = await request(app.getHttpServer())
    .post('/motorcycles')
    .set('Authorization', `Bearer ${token}`)
    .send({ registrationNumber: `REG-${tag}` })
    .expect(201);
  return { riderId: riderRes.body.id as string, motorcycleId: motoRes.body.id as string };
}

/** Create an assignment and a COMPLETED payment for a past day, returning nothing. */
async function earn(
  app: INestApplication,
  token: string,
  riderId: string,
  motorcycleId: string,
  date: string,
  target: number,
  amount: number,
) {
  const assignmentRes = await request(app.getHttpServer())
    .post('/assignments')
    .set('Authorization', `Bearer ${token}`)
    .send({ riderId, motorcycleId, assignedDate: date, targetAmount: target })
    .expect(201);
  const paymentRes = await request(app.getHttpServer())
    .post('/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({ dailyAssignmentId: assignmentRes.body.id, riderId, amount })
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
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  it('records expenses and reports a correct tenant-isolated P&L', async () => {
    const token = await signupOwner(app, 'owner-a@fleet-a.test', 'Fleet A');
    const { riderId, motorcycleId } = await setupFleet(app, token, 'A1');

    // Revenue: two completed payments totalling 15000.
    await earn(app, token, riderId, motorcycleId, isoDaysAgo(2), 10000, 10000);
    await earn(app, token, riderId, motorcycleId, isoDaysAgo(1), 10000, 5000);

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

    const perRider = await request(app.getHttpServer())
      .get('/analytics/per-rider')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(perRider.body).toHaveLength(1);
    expect(perRider.body[0]).toMatchObject({ revenue: '15000.00', paymentCount: 2 });

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
    const { riderId, motorcycleId } = await setupFleet(app, token, 'B1');

    await earn(app, token, riderId, motorcycleId, isoDaysAgo(20), 10000, 8000); // outside window
    await earn(app, token, riderId, motorcycleId, isoDaysAgo(2), 10000, 6000); // inside window

    const pnl = await request(app.getHttpServer())
      .get('/analytics/pnl')
      .query({ from: isoDaysAgo(7), to: isoDaysAgo(0) })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(pnl.body.revenue).toBe('6000.00');
    expect(pnl.body.paymentCount).toBe(1);
  });

  it('keeps each tenant to its own numbers and forbids riders', async () => {
    const tokenA = await signupOwner(app, 'owner-c@fleet-c.test', 'Fleet C');
    const fleetA = await setupFleet(app, tokenA, 'C1');
    await earn(app, tokenA, fleetA.riderId, fleetA.motorcycleId, isoDaysAgo(1), 10000, 10000);

    const tokenB = await signupOwner(app, 'owner-d@fleet-d.test', 'Fleet D');

    // Tenant B sees zero of tenant A's revenue.
    const pnlB = await request(app.getHttpServer())
      .get('/analytics/pnl')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(pnlB.body.revenue).toBe('0.00');

    // A rider is forbidden from analytics.
    const riderLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'rider-c1@test.local', password: 'riderpass123' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/analytics/pnl')
      .set('Authorization', `Bearer ${riderLogin.body.accessToken}`)
      .expect(403);
  });
});

async function currentTenantId(prisma: PrismaService, ownerEmail: string): Promise<string> {
  return requestContext.runUnscoped(async () => {
    const user = await prisma.client.user.findFirst({ where: { email: ownerEmail } });
    return user!.tenantId;
  });
}
