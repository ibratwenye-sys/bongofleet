import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { ExpenseStatus, UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestContext } from '../src/common/context/request-context';
import { hashPassword } from '../src/modules/auth/utils/password.util';
import { cleanDatabase, CLEAN_DATABASE_HOOK_TIMEOUT_MS } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';
import { signupAndActivateOwner } from './utils/verified-signup.util';

// A minimal valid 1x1 transparent PNG, real (not fake) image bytes for the
// receipt-upload test - same fixture documents.e2e-spec.ts already uses.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

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

async function currentTenantId(app: INestApplication, token: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .get('/auth/me')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body.tenantId as string;
}

async function seedManager(prisma: PrismaService, tenantId: string, tag: string) {
  const email = `manager-${tag.toLowerCase()}@test.local`;
  await prisma.client.user.create({
    data: {
      tenantId,
      email,
      phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
      passwordHash: await hashPassword('managerpass123'),
      role: UserRole.MANAGER,
      firstName: 'Man',
      lastName: tag,
    },
  });
  return { email, password: 'managerpass123' };
}

/** A RIDER driver + a compatible motorbike - Stage H2's rider-submission
 *  path is RIDER-only, so every fixture in this block uses the default
 *  driverType/vehicleType rather than the car/truck pairing DM4 needed. */
async function setupRider(app: INestApplication, ownerToken: string, tag: string) {
  const email = `rider-${tag.toLowerCase()}@test.local`;
  const driverRes = await request(app.getHttpServer())
    .post('/drivers')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      firstName: 'Rita',
      lastName: tag,
      phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
      email,
      licenseNumber: `LIC-${tag}`,
      initialPassword: 'riderpass123',
    })
    .expect(201);
  const motoRes = await request(app.getHttpServer())
    .post('/motorcycles')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ registrationNumber: `REG-${tag}` })
    .expect(201);
  return {
    driverId: driverRes.body.id as string,
    driverEmail: email,
    motorcycleId: motoRes.body.id as string,
  };
}

async function assignDay(
  app: INestApplication,
  ownerToken: string,
  driverId: string,
  motorcycleId: string,
  assignedDate: string,
) {
  const res = await request(app.getHttpServer())
    .post('/assignments')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ driverId, motorcycleId, assignedDate, targetAmount: 10000 })
    .expect(201);
  return res.body.id as string;
}

async function loginRider(app: INestApplication, email: string) {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: 'riderpass123' })
    .expect(200);
  return res.body.accessToken as string;
}

describe('Expenses (e2e)', () => {
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

  it('supports the full expense lifecycle with validation and filtering', async () => {
    const token = await signupOwner(app, 'owner@fleet.test', 'Fleet');

    const motoRes = await request(app.getHttpServer())
      .post('/motorcycles')
      .set('Authorization', `Bearer ${token}`)
      .send({ registrationNumber: 'REG-1' })
      .expect(201);
    const motorcycleId = motoRes.body.id as string;

    // Create (fleet-wide, no motorcycle) and one attributed to the bike.
    const created = await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'Office rent', amount: 50000, incurredAt: '2026-07-01' })
      .expect(201);
    expect(Number(created.body.amount)).toBe(50000);

    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'Fuel', amount: 3000, incurredAt: '2026-07-10', motorcycleId })
      .expect(201);

    // Negative amounts are rejected.
    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'Fuel', amount: -10, incurredAt: '2026-07-10' })
      .expect(400);

    // A non-existent motorcycle is rejected.
    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'Fuel', amount: 100, incurredAt: '2026-07-10', motorcycleId: 'nope' })
      .expect(404);

    // List all, then filter by motorcycle.
    const all = await request(app.getHttpServer())
      .get('/expenses')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(all.body).toHaveLength(2);

    const filtered = await request(app.getHttpServer())
      .get('/expenses')
      .query({ motorcycleId })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].category).toBe('Fuel');

    // Update then delete. Dashboard-created expenses default to APPROVED
    // (Stage H1) and Stage H2 makes an APPROVED expense immutable, so this
    // pre-H2 lifecycle test now has to move its target back to PENDING
    // directly via Prisma first - there is no "un-approve" endpoint, same
    // reasoning as every other status flip this suite sets up that way.
    const id = filtered.body[0].id as string;
    await requestContext.runUnscoped(() =>
      prisma.client.expense.update({ where: { id }, data: { status: ExpenseStatus.PENDING } }),
    );
    const updated = await request(app.getHttpServer())
      .patch(`/expenses/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 3500 })
      .expect(200);
    expect(Number(updated.body.amount)).toBe(3500);

    await request(app.getHttpServer())
      .delete(`/expenses/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/expenses/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('isolates expenses across tenants', async () => {
    const tokenA = await signupOwner(app, 'a@fleet.test', 'Fleet A');
    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ category: 'Fuel', amount: 1000, incurredAt: '2026-07-10' })
      .expect(201);

    const tokenB = await signupOwner(app, 'b@fleet.test', 'Fleet B');
    const listB = await request(app.getHttpServer())
      .get('/expenses')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(listB.body).toHaveLength(0);
  });

  describe('Stage H2 - rider submission + operator approve/reject', () => {
    it("a RIDER's submission with a same-day assignment creates a PENDING expense with the right motorcycleId/dailyAssignmentId", async () => {
      const token = await signupOwner(app, 'owner-h2a@fleet.test', 'Fleet H2A');
      const { driverId, driverEmail, motorcycleId } = await setupRider(app, token, 'H2A1');
      const assignmentId = await assignDay(app, token, driverId, motorcycleId, '2026-08-10');
      const riderToken = await loginRider(app, driverEmail);

      const res = await request(app.getHttpServer())
        .post('/expenses/submissions')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ category: 'Fuel', amount: 2000, incurredAt: '2026-08-10' })
        .expect(201);

      expect(res.body.status).toBe('PENDING');
      expect(res.body.motorcycleId).toBe(motorcycleId);
      expect(res.body.dailyAssignmentId).toBe(assignmentId);
      expect(res.body.submittedByRiderId).toBe(driverId);
    });

    it('a RIDER submitting with no assignment that date gets a 400 with the exact message', async () => {
      const token = await signupOwner(app, 'owner-h2b@fleet.test', 'Fleet H2B');
      const { driverEmail } = await setupRider(app, token, 'H2B1');
      const riderToken = await loginRider(app, driverEmail);

      const res = await request(app.getHttpServer())
        .post('/expenses/submissions')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ category: 'Fuel', amount: 2000, incurredAt: '2026-08-10' })
        .expect(400);
      expect(res.body.message).toBe('You had no assignment on that date.');
    });

    it("a RIDER's GET /expenses/mine returns own submissions across all statuses, with rejectionReason on the rejected one, and never another driver's", async () => {
      const token = await signupOwner(app, 'owner-h2c@fleet.test', 'Fleet H2C');
      const a = await setupRider(app, token, 'H2C1');
      const b = await setupRider(app, token, 'H2C2');
      await assignDay(app, token, a.driverId, a.motorcycleId, '2026-08-11');
      await assignDay(app, token, b.driverId, b.motorcycleId, '2026-08-11');

      const riderTokenA = await loginRider(app, a.driverEmail);
      const riderTokenB = await loginRider(app, b.driverEmail);

      const pendingRes = await request(app.getHttpServer())
        .post('/expenses/submissions')
        .set('Authorization', `Bearer ${riderTokenA}`)
        .send({ category: 'Fuel', amount: 1000, incurredAt: '2026-08-11' })
        .expect(201);
      const approveRes = await request(app.getHttpServer())
        .post('/expenses/submissions')
        .set('Authorization', `Bearer ${riderTokenA}`)
        .send({ category: 'Repairs', amount: 2000, incurredAt: '2026-08-11' })
        .expect(201);
      const rejectRes = await request(app.getHttpServer())
        .post('/expenses/submissions')
        .set('Authorization', `Bearer ${riderTokenA}`)
        .send({ category: 'Parking', amount: 500, incurredAt: '2026-08-11' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/expenses/${approveRes.body.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/expenses/${rejectRes.body.id}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rejectionReason: 'No receipt attached' })
        .expect(200);

      // Driver B submits one too, to prove A never sees it via /mine.
      await request(app.getHttpServer())
        .post('/expenses/submissions')
        .set('Authorization', `Bearer ${riderTokenB}`)
        .send({ category: 'Fuel', amount: 3000, incurredAt: '2026-08-11' })
        .expect(201);

      const mine = await request(app.getHttpServer())
        .get('/expenses/mine')
        .set('Authorization', `Bearer ${riderTokenA}`)
        .expect(200);

      expect(mine.body).toHaveLength(3);
      expect(
        mine.body.every((e: { submittedByRiderId: string }) => e.submittedByRiderId === a.driverId),
      ).toBe(true);
      const ids = mine.body.map((e: { id: string }) => e.id).sort();
      expect(ids).toEqual([pendingRes.body.id, approveRes.body.id, rejectRes.body.id].sort());
      const statuses = mine.body.map((e: { status: string }) => e.status).sort();
      expect(statuses).toEqual(['APPROVED', 'PENDING', 'REJECTED']);
      const rejected = mine.body.find((e: { status: string }) => e.status === 'REJECTED');
      expect(rejected.rejectionReason).toBe('No receipt attached');
    });

    it('OWNER GET /expenses?status=PENDING returns only pending rows; omitted status still returns everything', async () => {
      const token = await signupOwner(app, 'owner-h2d@fleet.test', 'Fleet H2D');
      const a = await setupRider(app, token, 'H2D1');
      await assignDay(app, token, a.driverId, a.motorcycleId, '2026-08-12');
      const riderToken = await loginRider(app, a.driverEmail);

      await request(app.getHttpServer())
        .post('/expenses/submissions')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ category: 'Fuel', amount: 1000, incurredAt: '2026-08-12' })
        .expect(201);
      const approveRes = await request(app.getHttpServer())
        .post('/expenses/submissions')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ category: 'Repairs', amount: 2000, incurredAt: '2026-08-12' })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/expenses/${approveRes.body.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const pendingOnly = await request(app.getHttpServer())
        .get('/expenses')
        .query({ status: 'PENDING' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(pendingOnly.body).toHaveLength(1);
      expect(pendingOnly.body[0].status).toBe('PENDING');

      const all = await request(app.getHttpServer())
        .get('/expenses')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(all.body).toHaveLength(2);
    });

    it('approve and reject work from PENDING, stamp the right fields, require a non-empty reason to reject, and reject re-deciding an already-decided expense', async () => {
      const token = await signupOwner(app, 'owner-h2e@fleet.test', 'Fleet H2E');
      const a = await setupRider(app, token, 'H2E1');
      await assignDay(app, token, a.driverId, a.motorcycleId, '2026-08-13');
      const riderToken = await loginRider(app, a.driverEmail);

      const approveTarget = await request(app.getHttpServer())
        .post('/expenses/submissions')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ category: 'Fuel', amount: 1000, incurredAt: '2026-08-13' })
        .expect(201);
      const rejectTarget = await request(app.getHttpServer())
        .post('/expenses/submissions')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ category: 'Repairs', amount: 2000, incurredAt: '2026-08-13' })
        .expect(201);

      // Reject requires a non-empty reason - missing and blank both rejected.
      await request(app.getHttpServer())
        .patch(`/expenses/${rejectTarget.body.id}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/expenses/${rejectTarget.body.id}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rejectionReason: '   ' })
        .expect(400);

      const approved = await request(app.getHttpServer())
        .patch(`/expenses/${approveTarget.body.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.approvedByUserId).toBeTruthy();
      expect(approved.body.approvedAt).toBeTruthy();

      const rejected = await request(app.getHttpServer())
        .patch(`/expenses/${rejectTarget.body.id}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rejectionReason: 'Not a real expense' })
        .expect(200);
      expect(rejected.body.status).toBe('REJECTED');
      expect(rejected.body.rejectionReason).toBe('Not a real expense');
      expect(rejected.body.approvedByUserId).toBeTruthy();

      // Re-deciding an already-decided expense fails, either direction.
      await request(app.getHttpServer())
        .patch(`/expenses/${approveTarget.body.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/expenses/${rejectTarget.body.id}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rejectionReason: 'Second try' })
        .expect(400);
    });

    it('a RIDER cannot call approve/reject, or the OWNER/MANAGER list/get (403, unchanged from today)', async () => {
      const token = await signupOwner(app, 'owner-h2f@fleet.test', 'Fleet H2F');
      const a = await setupRider(app, token, 'H2F1');
      await assignDay(app, token, a.driverId, a.motorcycleId, '2026-08-14');
      const riderToken = await loginRider(app, a.driverEmail);

      const submitted = await request(app.getHttpServer())
        .post('/expenses/submissions')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ category: 'Fuel', amount: 1000, incurredAt: '2026-08-14' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/expenses/${submitted.body.id}/approve`)
        .set('Authorization', `Bearer ${riderToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/expenses/${submitted.body.id}/reject`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ rejectionReason: 'nope' })
        .expect(403);
      await request(app.getHttpServer())
        .get('/expenses')
        .set('Authorization', `Bearer ${riderToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/expenses/${submitted.body.id}`)
        .set('Authorization', `Bearer ${riderToken}`)
        .expect(403);
    });

    it('update() and remove() on an APPROVED expense fail, for both OWNER and MANAGER actors', async () => {
      const ownerToken = await signupOwner(app, 'owner-h2g@fleet.test', 'Fleet H2G');
      const tenantId = await currentTenantId(app, ownerToken);
      const manager = await seedManager(prisma, tenantId, 'H2G');
      const managerLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: manager.email, password: manager.password })
        .expect(200);
      const managerToken = managerLogin.body.accessToken as string;

      const created = await request(app.getHttpServer())
        .post('/expenses')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ category: 'Office rent', amount: 5000, incurredAt: '2026-08-15' })
        .expect(201);
      // Dashboard-created expenses default to APPROVED (Stage H1) - no
      // separate approve() call is needed to reach that state.
      expect(created.body.status).toBe('APPROVED');

      await request(app.getHttpServer())
        .patch(`/expenses/${created.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ amount: 6000 })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/expenses/${created.body.id}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ amount: 6000 })
        .expect(400);
      await request(app.getHttpServer())
        .delete(`/expenses/${created.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(400);
      await request(app.getHttpServer())
        .delete(`/expenses/${created.body.id}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(400);
    });

    it("a RIDER can attach a receipt to their own PENDING expense, but not to someone else's or once it's decided", async () => {
      const token = await signupOwner(app, 'owner-h2h@fleet.test', 'Fleet H2H');
      const a = await setupRider(app, token, 'H2H1');
      const b = await setupRider(app, token, 'H2H2');
      await assignDay(app, token, a.driverId, a.motorcycleId, '2026-08-16');
      await assignDay(app, token, b.driverId, b.motorcycleId, '2026-08-16');
      const riderTokenA = await loginRider(app, a.driverEmail);
      const riderTokenB = await loginRider(app, b.driverEmail);

      const submitted = await request(app.getHttpServer())
        .post('/expenses/submissions')
        .set('Authorization', `Bearer ${riderTokenA}`)
        .send({ category: 'Fuel', amount: 1000, incurredAt: '2026-08-16' })
        .expect(201);

      // Someone else's row - not found, not forbidden (same convention as
      // everywhere else in this codebase).
      await request(app.getHttpServer())
        .post(`/expenses/${submitted.body.id}/receipt`)
        .set('Authorization', `Bearer ${riderTokenB}`)
        .attach('file', TINY_PNG, 'receipt.png')
        .expect(404);

      const uploaded = await request(app.getHttpServer())
        .post(`/expenses/${submitted.body.id}/receipt`)
        .set('Authorization', `Bearer ${riderTokenA}`)
        .attach('file', TINY_PNG, 'receipt.png')
        .expect(201);
      expect(uploaded.body.receiptFileName).toBe('receipt.png');

      await request(app.getHttpServer())
        .patch(`/expenses/${submitted.body.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/expenses/${submitted.body.id}/receipt`)
        .set('Authorization', `Bearer ${riderTokenA}`)
        .attach('file', TINY_PNG, 'receipt2.png')
        .expect(400);
    });
  });

  // Stage H3. Note while writing this: the task described this as mirroring
  // "the same shape of e2e test payment's receipt download already has" -
  // checked, and payment.e2e-spec.ts has no receipt test of any kind today
  // (upload or download), so there was nothing to mirror. The four scenarios
  // below come directly from the task's own explicit list instead.
  describe('Stage H3 - GET /expenses/:id/receipt', () => {
    it("OWNER/MANAGER can view any tenant receipt, a RIDER can view their own, a RIDER gets 404 (not 403) on someone else's, and a 404 when none was uploaded", async () => {
      const ownerToken = await signupOwner(app, 'owner-h3a@fleet.test', 'Fleet H3A');
      const a = await setupRider(app, ownerToken, 'H3A1');
      const b = await setupRider(app, ownerToken, 'H3A2');
      await assignDay(app, ownerToken, a.driverId, a.motorcycleId, '2026-08-17');
      await assignDay(app, ownerToken, b.driverId, b.motorcycleId, '2026-08-17');
      const riderTokenA = await loginRider(app, a.driverEmail);
      const riderTokenB = await loginRider(app, b.driverEmail);

      const withReceipt = await request(app.getHttpServer())
        .post('/expenses/submissions')
        .set('Authorization', `Bearer ${riderTokenA}`)
        .send({ category: 'Fuel', amount: 1000, incurredAt: '2026-08-17' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/expenses/${withReceipt.body.id}/receipt`)
        .set('Authorization', `Bearer ${riderTokenA}`)
        .attach('file', TINY_PNG, 'receipt.png')
        .expect(201);

      const noReceipt = await request(app.getHttpServer())
        .post('/expenses/submissions')
        .set('Authorization', `Bearer ${riderTokenA}`)
        .send({ category: 'Repairs', amount: 500, incurredAt: '2026-08-17' })
        .expect(201);

      const tenantId = await currentTenantId(app, ownerToken);
      const manager = await seedManager(prisma, tenantId, 'H3A');
      const managerLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: manager.email, password: manager.password })
        .expect(200);

      // OWNER and MANAGER can both view any tenant receipt.
      const ownerView = await request(app.getHttpServer())
        .get(`/expenses/${withReceipt.body.id}/receipt`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(ownerView.headers['content-type']).toContain('image/png');
      await request(app.getHttpServer())
        .get(`/expenses/${withReceipt.body.id}/receipt`)
        .set('Authorization', `Bearer ${managerLogin.body.accessToken}`)
        .expect(200);

      // A RIDER can view their own.
      await request(app.getHttpServer())
        .get(`/expenses/${withReceipt.body.id}/receipt`)
        .set('Authorization', `Bearer ${riderTokenA}`)
        .expect(200);

      // A RIDER gets 404 (not 403) on someone else's.
      await request(app.getHttpServer())
        .get(`/expenses/${withReceipt.body.id}/receipt`)
        .set('Authorization', `Bearer ${riderTokenB}`)
        .expect(404);

      // A 404 when no receipt was ever uploaded.
      await request(app.getHttpServer())
        .get(`/expenses/${noReceipt.body.id}/receipt`)
        .set('Authorization', `Bearer ${riderTokenA}`)
        .expect(404);
    });
  });
});
