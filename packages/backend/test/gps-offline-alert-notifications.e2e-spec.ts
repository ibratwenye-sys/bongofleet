import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { GpsSource, UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailerService } from '../src/modules/notification/mailer.service';
import { GpsOfflineAlertNotificationService } from '../src/modules/notification/gps-offline-alert-notification.service';
import { requestContext } from '../src/common/context/request-context';
import { cleanDatabase, CLEAN_DATABASE_HOOK_TIMEOUT_MS } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';
import { signupAndActivateOwner } from './utils/verified-signup.util';

const NOW = new Date('2026-09-05T08:00:00.000Z'); // 11:00 Africa/Dar_es_Salaam

async function signupOwner(app: INestApplication, email: string, company: string) {
  const { accessToken, tenantId } = await signupAndActivateOwner(app, {
    email,
    password: 'password123',
    companyName: company,
    firstName: 'Own',
    lastName: 'Er',
    phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
  });
  return { accessToken, tenantId };
}

async function createMotorcycle(app: INestApplication, token: string, registrationNumber: string) {
  const res = await request(app.getHttpServer())
    .post('/motorcycles')
    .set('Authorization', `Bearer ${token}`)
    .send({ registrationNumber })
    .expect(201);
  return res.body.id as string;
}

/** Seeds a GPS fix directly via Prisma - no clean API path writes a
 *  DEVICE/PHONE fix at an arbitrary controlled timestamp for this
 *  scenario, same "seed the exact state directly" convention other e2e
 *  specs in this codebase already use (e.g. expense.e2e-spec.ts flipping
 *  status back to PENDING via Prisma before its own lifecycle test). */
async function seedFix(
  tenantId: string,
  motorcycleId: string,
  recordedAt: Date,
  prisma: PrismaService,
) {
  await requestContext.runUnscoped(() =>
    prisma.client.gpsLocation.create({
      data: {
        tenantId,
        motorcycleId,
        source: GpsSource.PHONE,
        latitude: -6.79,
        longitude: 39.2,
        recordedAt,
      },
    }),
  );
}

describe('GPS offline-vehicle alert notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mailer: MailerService;
  let scanner: GpsOfflineAlertNotificationService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = await createTestApp(moduleFixture);
    prisma = moduleFixture.get(PrismaService);
    mailer = moduleFixture.get(MailerService);
    scanner = moduleFixture.get(GpsOfflineAlertNotificationService);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    jest.restoreAllMocks();
  }, CLEAN_DATABASE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  }, CLEAN_DATABASE_HOOK_TIMEOUT_MS);

  it('alerts a stale vehicle, writes a real GpsOfflineAlert row, and never mentions another tenant', async () => {
    const a = await signupOwner(app, 'owner-a@fleet-a.test', 'Fleet A');
    const motoA = await createMotorcycle(app, a.accessToken, 'REG-A1');
    await seedFix(a.tenantId, motoA, new Date(NOW.getTime() - 3 * 60 * 60 * 1000), prisma);

    // Tenant B: a vehicle reporting normally - must never appear in A's
    // digest and must get no digest of its own.
    const b = await signupOwner(app, 'owner-b@fleet-b.test', 'Fleet B');
    const motoB = await createMotorcycle(app, b.accessToken, 'REG-B1');
    await seedFix(b.tenantId, motoB, new Date(NOW.getTime() - 60 * 1000), prisma);

    // Spied here, not at the top of the test - signup itself sends a
    // verification-code email through this same mailer.send (Stage S1), so
    // spying earlier would corrupt the exact-call-count assertions below.
    const sendSpy = jest.spyOn(mailer, 'send');

    const result = await scanner.scanAndNotify(NOW);

    expect(result.tenantsScanned).toBe(2);
    expect(result.tenantsNotified).toBe(1);
    expect(result.alertsSent).toBe(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const digest = sendSpy.mock.calls[0][0];
    expect(digest.to).toEqual(['owner-a@fleet-a.test']);
    expect(digest.text).toContain('REG-A1');
    expect(digest.text).not.toContain('REG-B1');

    const alerts = await requestContext.runUnscoped(() => prisma.client.gpsOfflineAlert.findMany());
    expect(alerts).toHaveLength(1);
    expect(alerts[0].motorcycleId).toBe(motoA);
    expect(alerts[0].lastRecordedAt).not.toBeNull();

    // Second scan the same day: silence - already alerted today.
    sendSpy.mockClear();
    const second = await scanner.scanAndNotify(NOW);
    expect(second.alertsSent).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('skips a tenant with no active OWNER and no tenant contact email, without recording an unsent alert', async () => {
    const c = await signupOwner(app, 'owner-c@fleet-c.test', 'Fleet C');
    const motoC = await createMotorcycle(app, c.accessToken, 'REG-C1');
    await seedFix(c.tenantId, motoC, new Date(NOW.getTime() - 3 * 60 * 60 * 1000), prisma);

    // No endpoint deactivates the only OWNER on their own tenant - seeded
    // directly, same convention as seedFix above.
    await requestContext.runUnscoped(() =>
      prisma.client.user.updateMany({
        where: { tenantId: c.tenantId, role: UserRole.OWNER },
        data: { isActive: false },
      }),
    );

    const sendSpy = jest.spyOn(mailer, 'send');
    const result = await scanner.scanAndNotify(NOW);

    expect(result.alertsSent).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
    const alerts = await requestContext.runUnscoped(() =>
      prisma.client.gpsOfflineAlert.findMany({ where: { motorcycleId: motoC } }),
    );
    expect(alerts).toHaveLength(0);
  });
});
