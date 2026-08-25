import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/modules/auth/utils/password.util';
import { cleanDatabase, CLEAN_DATABASE_HOOK_TIMEOUT_MS } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';
import { signupAndActivateOwner } from './utils/verified-signup.util';
import { buildBulkImportWorkbook } from './utils/bulk-import-workbook.util';

async function loginAsManager(
  prisma: PrismaService,
  app: INestApplication,
  tenantId: string,
): Promise<string> {
  const passwordHash = await hashPassword('password123');
  await prisma.client.user.create({
    data: {
      tenantId,
      email: 'manager@bulk-import.test',
      phone: '+255700000802',
      passwordHash,
      role: UserRole.MANAGER,
      firstName: 'M',
      lastName: 'Anager',
    },
  });
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: 'manager@bulk-import.test', password: 'password123' })
    .expect(200);
  return res.body.accessToken as string;
}

async function signupOwner(app: INestApplication, overrides: Partial<Record<string, string>> = {}) {
  const body = {
    email: 'owner@bulk-import.test',
    password: 'password123',
    companyName: 'Bulk Import Fleet',
    firstName: 'Ibrahim',
    lastName: 'Owner',
    phone: '+255700000801',
    ...overrides,
  };
  return signupAndActivateOwner(app, body);
}

describe('Bulk import (e2e, Stage BI1)', () => {
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

  function oneVehicleOneDriverOnePlan(
    overrides: { openingBalance?: number; registrationNumber?: string; phone?: string } = {},
  ) {
    const registrationNumber = overrides.registrationNumber ?? 'T111 AAA';
    const phone = overrides.phone ?? '0712000001';
    return buildBulkImportWorkbook({
      vehicles: [{ registrationNumber, vehicleType: 'MOTORBIKE' }],
      drivers: [{ firstName: 'Juma', lastName: 'Hassan', phone }],
      assignments: [{ driverPhone: phone, vehicleRegistrationNumber: registrationNumber }],
      ownershipPlans: [
        {
          driverPhone: phone,
          vehicleRegistrationNumber: registrationNumber,
          dailyAmount: 12000,
          instalmentCount: 150,
          totalPrice: 1800000,
          startDate: '2025-01-15',
          openingBalance: overrides.openingBalance ?? 0,
        },
      ],
    });
  }

  async function findPlanByRegistration(accessToken: string, registrationNumber: string) {
    const res = await request(app.getHttpServer())
      .get('/ownership-plans')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    return res.body.find(
      (p: { motorcycle: { registrationNumber: string } }) =>
        p.motorcycle.registrationNumber === registrationNumber,
    );
  }

  describe('POST /bulk-import/preview', () => {
    it('validates and returns a per-sheet, per-row result, writing nothing', async () => {
      const { accessToken } = await signupOwner(app);
      const buffer = await oneVehicleOneDriverOnePlan();

      const res = await request(app.getHttpServer())
        .post('/bulk-import/preview')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', buffer, { filename: 'import.xlsx' })
        .expect(201);

      expect(res.body.canCommit).toBe(true);
      const sheetNames = res.body.sheets.map((s: { sheet: string }) => s.sheet);
      expect(sheetNames).toEqual(['vehicles', 'drivers', 'assignments', 'ownershipPlans']);
      const vehicleSheet = res.body.sheets.find((s: { sheet: string }) => s.sheet === 'vehicles');
      expect(vehicleSheet.rows[0].status).toBe('new');

      // Writes nothing - confirmed via a follow-up list query.
      const vehiclesAfter = await request(app.getHttpServer())
        .get('/motorcycles')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(vehiclesAfter.body).toHaveLength(0);
      const driversAfter = await request(app.getHttpServer())
        .get('/drivers')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(driversAfter.body).toHaveLength(0);
      const plansAfter = await request(app.getHttpServer())
        .get('/ownership-plans')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(plansAfter.body).toHaveLength(0);
    });

    it('flags a missing required field as a row-level error, in plain language', async () => {
      const { accessToken } = await signupOwner(app);
      const buffer = await buildBulkImportWorkbook({
        vehicles: [{ registrationNumber: '', vehicleType: 'MOTORBIKE' }],
        drivers: [],
        assignments: [],
        ownershipPlans: [],
      });

      const res = await request(app.getHttpServer())
        .post('/bulk-import/preview')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', buffer, { filename: 'import.xlsx' })
        .expect(201);

      expect(res.body.canCommit).toBe(false);
      const vehicleSheet = res.body.sheets.find((s: { sheet: string }) => s.sheet === 'vehicles');
      expect(vehicleSheet.rows[0].status).toBe('error');
      expect(vehicleSheet.rows[0].messages[0].text).toMatch(/Registration Number is required/);
    });

    it('rejects everyone but OWNER, including MANAGER (tighter than the document-upload precedent)', async () => {
      const { tenantId } = await signupOwner(app);
      const managerToken = await loginAsManager(prisma, app, tenantId);

      const buffer = await oneVehicleOneDriverOnePlan();
      await request(app.getHttpServer())
        .post('/bulk-import/preview')
        .set('Authorization', `Bearer ${managerToken}`)
        .attach('file', buffer, { filename: 'import.xlsx' })
        .expect(403);
    });
  });

  describe('POST /bulk-import/commit', () => {
    it('writes vehicles, drivers, and the ownership plan atomically', async () => {
      const { accessToken } = await signupOwner(app);
      const buffer = await oneVehicleOneDriverOnePlan();

      const res = await request(app.getHttpServer())
        .post('/bulk-import/commit')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', buffer, { filename: 'import.xlsx' })
        .expect(201);

      expect(res.body.counts).toEqual({
        vehiclesCreated: 1,
        vehiclesUpdated: 0,
        driversCreated: 1,
        driversUpdated: 0,
        ownershipPlansCreated: 1,
        ownershipPlansUpdated: 0,
      });

      const plan = await findPlanByRegistration(accessToken, 'T111 AAA');
      expect(plan).toBeDefined();
      expect(plan?.driver.user.firstName).toBe('Juma');
    });

    it('one bad row in a large workbook rolls back the WHOLE commit, not just that row', async () => {
      const { accessToken } = await signupOwner(app);
      const buffer = await buildBulkImportWorkbook({
        vehicles: [
          { registrationNumber: 'T222 BBB', vehicleType: 'MOTORBIKE' },
          { registrationNumber: 'T222 CCC', vehicleType: 'MOTORBIKE' },
        ],
        drivers: [
          { firstName: 'Good', lastName: 'Driver', phone: '0712000010' },
          { firstName: 'Bad', lastName: 'Driver', phone: '' }, // missing required phone
        ],
        assignments: [{ driverPhone: '0712000010', vehicleRegistrationNumber: 'T222 BBB' }],
        ownershipPlans: [
          {
            driverPhone: '0712000010',
            vehicleRegistrationNumber: 'T222 BBB',
            dailyAmount: 12000,
            instalmentCount: 150,
            totalPrice: 1800000,
            startDate: '2025-01-15',
          },
        ],
      });

      await request(app.getHttpServer())
        .post('/bulk-import/commit')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', buffer, { filename: 'import.xlsx' })
        .expect(400);

      const vehiclesAfter = await request(app.getHttpServer())
        .get('/motorcycles')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      // Neither vehicle was written - not even the one on an otherwise-clean row.
      expect(vehiclesAfter.body).toHaveLength(0);
      const driversAfter = await request(app.getHttpServer())
        .get('/drivers')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(driversAfter.body).toHaveLength(0);
    });

    it('re-import idempotency: committing the same file twice creates no duplicates, and updates in place', async () => {
      const { accessToken } = await signupOwner(app);
      const buffer = await oneVehicleOneDriverOnePlan();

      const first = await request(app.getHttpServer())
        .post('/bulk-import/commit')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', buffer, { filename: 'import.xlsx' })
        .expect(201);
      expect(first.body.counts.vehiclesCreated).toBe(1);
      expect(first.body.counts.driversCreated).toBe(1);
      expect(first.body.counts.ownershipPlansCreated).toBe(1);

      const second = await request(app.getHttpServer())
        .post('/bulk-import/commit')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', buffer, { filename: 'import.xlsx' })
        .expect(201);
      expect(second.body.counts).toEqual({
        vehiclesCreated: 0,
        vehiclesUpdated: 1,
        driversCreated: 0,
        driversUpdated: 1,
        ownershipPlansCreated: 0,
        ownershipPlansUpdated: 1,
      });

      const vehiclesAfter = await request(app.getHttpServer())
        .get('/motorcycles')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(vehiclesAfter.body).toHaveLength(1);
      const plansAfter = await request(app.getHttpServer())
        .get('/ownership-plans')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(plansAfter.body).toHaveLength(1);
    });

    it('two bikes, one driver: a driver who financed a second bike gets two plans, not a collapsed or rejected duplicate', async () => {
      const { accessToken } = await signupOwner(app);
      const phone = '0712000020';
      const buffer = await buildBulkImportWorkbook({
        vehicles: [
          { registrationNumber: 'T333 DDD', vehicleType: 'MOTORBIKE' },
          { registrationNumber: 'T333 EEE', vehicleType: 'MOTORBIKE' },
        ],
        drivers: [{ firstName: 'Bernad', lastName: 'Godwin', phone }],
        assignments: [
          { driverPhone: phone, vehicleRegistrationNumber: 'T333 DDD' },
          { driverPhone: phone, vehicleRegistrationNumber: 'T333 EEE' },
        ],
        ownershipPlans: [
          {
            driverPhone: phone,
            vehicleRegistrationNumber: 'T333 DDD',
            dailyAmount: 12000,
            instalmentCount: 150,
            totalPrice: 1800000,
            startDate: '2024-01-15',
          },
          {
            driverPhone: phone,
            vehicleRegistrationNumber: 'T333 EEE',
            dailyAmount: 15000,
            instalmentCount: 200,
            totalPrice: 3000000,
            startDate: '2025-06-01',
          },
        ],
      });

      const res = await request(app.getHttpServer())
        .post('/bulk-import/commit')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', buffer, { filename: 'import.xlsx' })
        .expect(201);

      expect(res.body.counts.driversCreated).toBe(1);
      expect(res.body.counts.ownershipPlansCreated).toBe(2);

      const plans = await request(app.getHttpServer())
        .get('/ownership-plans')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(plans.body).toHaveLength(2);
      const driverIds = new Set(plans.body.map((p: { driverId: string }) => p.driverId));
      expect(driverIds.size).toBe(1);
    });

    it('tenant isolation: an import from tenant A never touches tenant B, and never reports a false already-exists match against tenant B', async () => {
      const ownerA = await signupOwner(app, {
        email: 'owner-a@bulk-import.test',
        companyName: 'Fleet A',
        phone: '+255700000803',
      });
      const ownerB = await signupOwner(app, {
        email: 'owner-b@bulk-import.test',
        companyName: 'Fleet B',
        phone: '+255700000804',
      });

      // Tenant B already has this exact registration number and phone.
      const bufferB = await oneVehicleOneDriverOnePlan();
      await request(app.getHttpServer())
        .post('/bulk-import/commit')
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .attach('file', bufferB, { filename: 'import.xlsx' })
        .expect(201);

      // Tenant A imports the SAME registration number and phone - must read
      // as brand new for tenant A, never as an update to tenant B's rows.
      const bufferA = await oneVehicleOneDriverOnePlan();
      const previewA = await request(app.getHttpServer())
        .post('/bulk-import/preview')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .attach('file', bufferA, { filename: 'import.xlsx' })
        .expect(201);
      const vehicleSheet = previewA.body.sheets.find(
        (s: { sheet: string }) => s.sheet === 'vehicles',
      );
      expect(vehicleSheet.rows[0].status).toBe('new');
      const driverSheet = previewA.body.sheets.find(
        (s: { sheet: string }) => s.sheet === 'drivers',
      );
      expect(driverSheet.rows[0].status).toBe('new');

      await request(app.getHttpServer())
        .post('/bulk-import/commit')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .attach('file', bufferA, { filename: 'import.xlsx' })
        .expect(201);

      const plansA = await request(app.getHttpServer())
        .get('/ownership-plans')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .expect(200);
      const plansB = await request(app.getHttpServer())
        .get('/ownership-plans')
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .expect(200);
      expect(plansA.body).toHaveLength(1);
      expect(plansB.body).toHaveLength(1);
      expect(plansA.body[0].id).not.toBe(plansB.body[0].id);
    });
  });

  describe('opening balance (§5) - the mandatory test', () => {
    it('a nonzero opening balance immediately shows daysBehind 0, no missed-day streak, and remainingToOwn reduced by exactly the balance', async () => {
      const { accessToken } = await signupOwner(app);
      const openingBalance = 240000; // 20 days' worth at 12,000/day
      const buffer = await oneVehicleOneDriverOnePlan({
        openingBalance,
        registrationNumber: 'T444 FFF',
        phone: '0712000030',
      });

      await request(app.getHttpServer())
        .post('/bulk-import/commit')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', buffer, { filename: 'import.xlsx' })
        .expect(201);

      const plan = await findPlanByRegistration(accessToken, 'T444 FFF');
      expect(plan).toBeDefined();
      expect(plan?.daysBehind).toBe(0);
      expect(plan?.consecutiveMissedDays).toBe(0);
      // totalOwed = 12,000 x 150 = 1,800,000; remainingToOwn must be reduced
      // by exactly the opening balance, not merely "not negative".
      expect(plan?.remainingToOwn).toBe((1_800_000 - openingBalance).toFixed(2));
    });

    it('a zero opening balance creates no synthetic assignment/payment at all', async () => {
      const { accessToken } = await signupOwner(app);
      const buffer = await oneVehicleOneDriverOnePlan({
        openingBalance: 0,
        registrationNumber: 'T555 GGG',
        phone: '0712000040',
      });

      await request(app.getHttpServer())
        .post('/bulk-import/commit')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', buffer, { filename: 'import.xlsx' })
        .expect(201);

      const plan = await findPlanByRegistration(accessToken, 'T555 GGG');
      expect(plan?.amountBilled).toBe('0.00');
      expect(plan?.remainingToOwn).toBe('1800000.00');
    });
  });
});
