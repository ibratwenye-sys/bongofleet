import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailerService } from '../src/modules/notification/mailer.service';
import { MaintenanceReminderNotificationService } from '../src/modules/notification/maintenance-reminder-notification.service';
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
  return res.body.accessToken as string;
}

async function createMotorcycle(app: INestApplication, token: string, reg: string) {
  const res = await request(app.getHttpServer())
    .post('/motorcycles')
    .set('Authorization', `Bearer ${token}`)
    .send({ registrationNumber: reg })
    .expect(201);
  return res.body.id as string;
}

describe('Maintenance & reminders (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mailer: MailerService;
  let scanner: MaintenanceReminderNotificationService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = await createTestApp(moduleFixture);
    prisma = moduleFixture.get(PrismaService);
    mailer = moduleFixture.get(MailerService);
    scanner = moduleFixture.get(MaintenanceReminderNotificationService);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  it('logs a service, bumps the bike odometer, lists and deletes; validates input', async () => {
    const token = await signupOwner(app, 'owner@fleet.test', 'Fleet');
    const motorcycleId = await createMotorcycle(app, token, 'REG-1');

    const created = await request(app.getHttpServer())
      .post('/maintenance')
      .set('Authorization', `Bearer ${token}`)
      .send({
        motorcycleId,
        description: 'Oil change',
        cost: 15000,
        performedAt: isoDaysFromNow(-1),
        mileageAtService: 8200,
        nextServiceDate: isoDaysFromNow(60),
        nextServiceMileage: 11000,
      })
      .expect(201);
    expect(Number(created.body.cost)).toBe(15000);
    const logId = created.body.id as string;

    // Odometer bumped to the service reading.
    const bike = await request(app.getHttpServer())
      .get(`/motorcycles/${motorcycleId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(bike.body.currentMileage).toBe(8200);

    // Negative cost rejected.
    await request(app.getHttpServer())
      .post('/maintenance')
      .set('Authorization', `Bearer ${token}`)
      .send({ motorcycleId, description: 'x', cost: -5, performedAt: isoDaysFromNow(0) })
      .expect(400);

    // Non-existent bike rejected.
    await request(app.getHttpServer())
      .post('/maintenance')
      .set('Authorization', `Bearer ${token}`)
      .send({ motorcycleId: 'nope', description: 'x', cost: 100, performedAt: isoDaysFromNow(0) })
      .expect(404);

    const list = await request(app.getHttpServer())
      .get(`/maintenance?motorcycleId=${motorcycleId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body).toHaveLength(1);

    await request(app.getHttpServer())
      .delete(`/maintenance/${logId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/maintenance/${logId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('reminds owners about overdue (date) and due-soon (mileage) bikes, once each, tenant-isolated', async () => {
    const sendSpy = jest.spyOn(mailer, 'send');

    const token = await signupOwner(app, 'owner-a@fleet-a.test', 'Fleet A');
    const overdueBike = await createMotorcycle(app, token, 'KDA-OVER');
    const soonBike = await createMotorcycle(app, token, 'KDA-SOON');
    const okBike = await createMotorcycle(app, token, 'KDA-OK');

    // Overdue by date.
    await request(app.getHttpServer())
      .post('/maintenance')
      .set('Authorization', `Bearer ${token}`)
      .send({
        motorcycleId: overdueBike,
        description: 'Brakes',
        cost: 5000,
        performedAt: isoDaysFromNow(-40),
        nextServiceDate: isoDaysFromNow(-3),
      })
      .expect(201);

    // Due soon by mileage: set odometer to 9800 via the service reading, target 10000 (buffer 500).
    await request(app.getHttpServer())
      .post('/maintenance')
      .set('Authorization', `Bearer ${token}`)
      .send({
        motorcycleId: soonBike,
        description: 'Chain',
        cost: 3000,
        performedAt: isoDaysFromNow(-5),
        mileageAtService: 9800,
        nextServiceMileage: 10000,
      })
      .expect(201);

    // Not due: far-future date.
    await request(app.getHttpServer())
      .post('/maintenance')
      .set('Authorization', `Bearer ${token}`)
      .send({
        motorcycleId: okBike,
        description: 'Service',
        cost: 2000,
        performedAt: isoDaysFromNow(-2),
        nextServiceDate: isoDaysFromNow(90),
      })
      .expect(201);

    // Another tenant with an overdue bike - must not leak into Fleet A's digest.
    const tokenB = await signupOwner(app, 'owner-b@fleet-b.test', 'Fleet B');
    const bBike = await createMotorcycle(app, tokenB, 'KDB-OVER');
    await request(app.getHttpServer())
      .post('/maintenance')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        motorcycleId: bBike,
        description: 'Brakes',
        cost: 5000,
        performedAt: isoDaysFromNow(-10),
        nextServiceDate: isoDaysFromNow(-1),
      })
      .expect(201);

    const first = await scanner.scanAndNotify();
    expect(first.tenantsScanned).toBe(2);
    expect(first.tenantsNotified).toBe(2);
    expect(first.remindersSent).toBe(3); // 2 for A, 1 for B

    const digestA = sendSpy.mock.calls.find((c) => c[0].to.includes('owner-a@fleet-a.test'))![0];
    expect(digestA.text).toContain('OVERDUE:');
    expect(digestA.text).toContain('KDA-OVER');
    expect(digestA.text).toContain('DUE SOON:');
    expect(digestA.text).toContain('KDA-SOON');
    expect(digestA.text).not.toContain('KDA-OK');
    expect(digestA.text).not.toContain('KDB-OVER');

    // Reminder rows recorded.
    const reminders = await requestContext.runUnscoped(() =>
      prisma.client.maintenanceReminder.findMany(),
    );
    expect(reminders).toHaveLength(3);

    // Second scan: silence.
    sendSpy.mockClear();
    const second = await scanner.scanAndNotify();
    expect(second.remindersSent).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
