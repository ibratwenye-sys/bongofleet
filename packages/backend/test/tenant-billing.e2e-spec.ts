import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestContext } from '../src/common/context/request-context';
import { hashPassword } from '../src/modules/auth/utils/password.util';
import { cleanDatabase, CLEAN_DATABASE_HOOK_TIMEOUT_MS } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';
import { signupAndActivateOwner } from './utils/verified-signup.util';

// The seeded row from the Stage SUB1 migration
// (20260824181013_stage_sub1_subscription_pricing) - a base tier every
// tenant resolves against, never truncated by cleanDatabase() (see that
// file's TABLES_FK_SAFE_ORDER: this is global platform config, not
// per-tenant scenario data, so it persists across tests the same way a
// real one-time seed would).
const SEEDED_RATE = '10000.00';

describe('Tenant billing (e2e, Stage SUB1, DESIGN_SUBSCRIPTION.md §5b)', () => {
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

  async function signupOwner(overrides: Partial<Record<string, string>> = {}) {
    const body = {
      email: 'owner@billing-fleet.test',
      password: 'password123',
      companyName: 'Billing Fleet',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '+254700000501',
      ...overrides,
    };
    const { accessToken, tenantId } = await signupAndActivateOwner(app, body);
    return { accessToken, tenantId };
  }

  async function createMotorcycle(accessToken: string, registrationNumber: string) {
    const res = await request(app.getHttpServer())
      .post('/motorcycles')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ registrationNumber })
      .expect(201);
    return res.body.id as string;
  }

  async function loginAs(tenantId: string, email: string, role: UserRole, phone: string) {
    const passwordHash = await hashPassword('password123');
    await requestContext.runUnscoped(() =>
      prisma.client.user.create({
        data: {
          tenantId,
          email,
          phone,
          passwordHash,
          role,
          firstName: 'Test',
          lastName: 'User',
        },
      }),
    );
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' })
      .expect(200);
    return res.body.accessToken as string;
  }

  it('counts only active bikes, and prices them at the seeded rate as a real Decimal product', async () => {
    const { accessToken } = await signupOwner();

    const bike1 = await createMotorcycle(accessToken, 'KDA-001A');
    await createMotorcycle(accessToken, 'KDA-002A');
    await createMotorcycle(accessToken, 'KDA-003A');

    // Deactivate one - it must not count towards activeBikeCount.
    await request(app.getHttpServer())
      .delete(`/motorcycles/${bike1}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const res = await request(app.getHttpServer())
      .get('/tenant/billing')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.activeBikeCount).toBe(2);
    expect(res.body.pricePerBikePerMonth).toBe(SEEDED_RATE);
    // 2 x 10000.00 = 20000.00, exactly - a real Decimal product, not a
    // float multiplication that could drift.
    expect(res.body.estimatedMonthlyTotal).toBe('20000.00');
  });

  it('reflects status and trialEndsAt from the tenant row', async () => {
    const { accessToken } = await signupOwner();

    const res = await request(app.getHttpServer())
      .get('/tenant/billing')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.status).toBe('ACTIVE');
    expect(typeof res.body.trialEndsAt).toBe('string');
    expect(res.body.billingExempt).toBe(false);
  });

  // Stamps billingExemptAt BEFORE this tenant's billing view is ever read,
  // rather than mutating it between two GETs on the same tenant - GET
  // /tenant/billing is cached for TENANT_CACHE_TTL_MS (see
  // TenantCacheService), same as every other tenant-cache read in this
  // codebase, and nothing invalidates that cache on a direct DB write made
  // outside the request path. That is the documented, deliberate tradeoff
  // this cache already makes everywhere else (self-heals within the TTL,
  // never asserted synchronously) - not something this test should special-case.
  it('reflects billingExempt: true for a tenant already exempt when first read', async () => {
    const { accessToken, tenantId } = await signupOwner({
      email: 'owner@exempt-fleet.test',
      companyName: 'Exempt Fleet',
      phone: '+254700000505',
    });
    await requestContext.runUnscoped(() =>
      prisma.client.tenant.update({
        where: { id: tenantId },
        data: { billingExemptAt: new Date() },
      }),
    );

    const res = await request(app.getHttpServer())
      .get('/tenant/billing')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.billingExempt).toBe(true);
  });

  it('rejects MANAGER, RIDER, and MECHANIC with 403 - OWNER only', async () => {
    const { accessToken: ownerToken, tenantId } = await signupOwner();
    await createMotorcycle(ownerToken, 'KDA-001A');

    const managerToken = await loginAs(
      tenantId,
      'manager@billing-fleet.test',
      UserRole.MANAGER,
      '+254700000502',
    );
    const riderToken = await loginAs(
      tenantId,
      'rider@billing-fleet.test',
      UserRole.RIDER,
      '+254700000503',
    );
    const mechanicToken = await loginAs(
      tenantId,
      'mechanic@billing-fleet.test',
      UserRole.MECHANIC,
      '+254700000504',
    );

    for (const token of [managerToken, riderToken, mechanicToken]) {
      await request(app.getHttpServer())
        .get('/tenant/billing')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    }
  });
});
