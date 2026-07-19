import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailerService } from '../src/modules/notification/mailer.service';
import { MissedPaymentNotificationService } from '../src/modules/notification/missed-payment-notification.service';
import { requestContext } from '../src/common/context/request-context';
import { cleanDatabase } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';

function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
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
  return { accessToken: res.body.accessToken as string };
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

async function createAssignment(
  app: INestApplication,
  token: string,
  riderId: string,
  motorcycleId: string,
  assignedDate: string,
  targetAmount: number,
) {
  const res = await request(app.getHttpServer())
    .post('/assignments')
    .set('Authorization', `Bearer ${token}`)
    .send({ riderId, motorcycleId, assignedDate, targetAmount })
    .expect(201);
  return res.body.id as string;
}

async function recordPayment(
  app: INestApplication,
  token: string,
  dailyAssignmentId: string,
  riderId: string,
  amount: number,
) {
  const res = await request(app.getHttpServer())
    .post('/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({ dailyAssignmentId, riderId, amount })
    .expect(201);
  return res.body.id as string;
}

describe('Missed-payment notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mailer: MailerService;
  let scanner: MissedPaymentNotificationService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = await createTestApp(moduleFixture);
    prisma = moduleFixture.get(PrismaService);
    mailer = moduleFixture.get(MailerService);
    scanner = moduleFixture.get(MissedPaymentNotificationService);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  it('alerts unpaid and underpaid past days once, ignores paid days, today, and other tenants', async () => {
    const sendSpy = jest.spyOn(mailer, 'send');

    // Tenant A: three past assignments (unpaid / underpaid / fully paid) + one today.
    const a = await signupOwner(app, 'owner-a@fleet-a.test', 'Fleet A');
    const fleetA = await setupFleet(app, a.accessToken, 'A1');

    const unpaidId = await createAssignment(
      app,
      a.accessToken,
      fleetA.riderId,
      fleetA.motorcycleId,
      isoDaysFromNow(-3),
      10000,
    );
    const underpaidId = await createAssignment(
      app,
      a.accessToken,
      fleetA.riderId,
      fleetA.motorcycleId,
      isoDaysFromNow(-2),
      10000,
    );
    await recordPayment(app, a.accessToken, underpaidId, fleetA.riderId, 6000);

    const paidId = await createAssignment(
      app,
      a.accessToken,
      fleetA.riderId,
      fleetA.motorcycleId,
      isoDaysFromNow(-1),
      10000,
    );
    await recordPayment(app, a.accessToken, paidId, fleetA.riderId, 10000);

    // Today's assignment - still in progress, must never alert.
    await createAssignment(
      app,
      a.accessToken,
      fleetA.riderId,
      fleetA.motorcycleId,
      isoDaysFromNow(0),
      10000,
    );

    // Tenant B: an unpaid past day of its own - must get its own digest only.
    const b = await signupOwner(app, 'owner-b@fleet-b.test', 'Fleet B');
    const fleetB = await setupFleet(app, b.accessToken, 'B1');
    await createAssignment(
      app,
      b.accessToken,
      fleetB.riderId,
      fleetB.motorcycleId,
      isoDaysFromNow(-1),
      5000,
    );

    const first = await scanner.scanAndNotify();
    expect(first.tenantsScanned).toBe(2);
    expect(first.tenantsNotified).toBe(2);
    expect(first.alertsSent).toBe(3);
    expect(sendSpy).toHaveBeenCalledTimes(2);

    const digestA = sendSpy.mock.calls.find((call) =>
      call[0].to.includes('owner-a@fleet-a.test'),
    )![0];
    expect(digestA.text).toContain('NO PAYMENT RECORDED:');
    expect(digestA.text).toContain('PAID UNDER TARGET:');
    expect(digestA.text).toContain('short by 4000.00');
    expect(digestA.text).toContain('REG-A1');
    expect(digestA.text).not.toContain('REG-B1');

    const digestB = sendSpy.mock.calls.find((call) =>
      call[0].to.includes('owner-b@fleet-b.test'),
    )![0];
    expect(digestB.text).toContain('REG-B1');
    expect(digestB.text).not.toContain('REG-A1');

    // Alerts recorded for exactly the unpaid + underpaid assignments.
    const alerts = await requestContext.runUnscoped(() =>
      prisma.client.assignmentAlert.findMany({ orderBy: { sentAt: 'asc' } }),
    );
    expect(alerts.map((alert) => alert.dailyAssignmentId).sort()).toEqual(
      expect.arrayContaining([unpaidId, underpaidId]),
    );
    expect(alerts).toHaveLength(3);

    // Second scan: silence - nobody is nagged twice about the same day.
    sendSpy.mockClear();
    const second = await scanner.scanAndNotify();
    expect(second.tenantsNotified).toBe(0);
    expect(second.alertsSent).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('counts pending payments toward the target and mentions them in the digest', async () => {
    const sendSpy = jest.spyOn(mailer, 'send');

    const c = await signupOwner(app, 'owner-c@fleet-c.test', 'Fleet C');
    const fleet = await setupFleet(app, c.accessToken, 'C1');
    const assignmentId = await createAssignment(
      app,
      c.accessToken,
      fleet.riderId,
      fleet.motorcycleId,
      isoDaysFromNow(-1),
      10000,
    );
    // Rider recorded 7000 but it is still PENDING reconciliation.
    await recordPayment(app, c.accessToken, assignmentId, fleet.riderId, 7000);

    const result = await scanner.scanAndNotify();
    expect(result.alertsSent).toBe(1);

    const digest = sendSpy.mock.calls[0][0];
    expect(digest.text).toContain('paid 7000.00 of 10000.00');
    expect(digest.text).toContain('7000.00 of this is pending reconciliation');

    const alerts = await requestContext.runUnscoped(() => prisma.client.assignmentAlert.findMany());
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe('SHORTFALL');
  });
});
