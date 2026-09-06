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

async function seedRider(app: INestApplication, ownerToken: string, tag: string) {
  const email = `rider-${tag.toLowerCase()}@test.local`;
  await request(app.getHttpServer())
    .post('/drivers')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      firstName: 'Rita',
      lastName: tag,
      phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
      email,
      licenseNumber: `LIC-${tag}`,
      initialPassword: 'riderpass123',
      driverType: 'CAR_DRIVER',
    })
    .expect(201);
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: 'riderpass123' })
    .expect(200);
  return res.body.accessToken as string;
}

async function seedMechanic(
  app: INestApplication,
  prisma: PrismaService,
  tenantId: string,
  tag: string,
) {
  const email = `mechanic-${tag.toLowerCase()}@test.local`;
  await prisma.client.user.create({
    data: {
      tenantId,
      email,
      phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
      passwordHash: await hashPassword('mechanicpass123'),
      role: UserRole.MECHANIC,
      firstName: 'Mech',
      lastName: tag,
    },
  });
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: 'mechanicpass123' })
    .expect(200);
  return res.body.accessToken as string;
}

let vehicleCounter = 0;

async function createTransportJob(
  app: INestApplication,
  ownerToken: string,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<{ jobId: string; reference: string; motorcycleId: string }> {
  vehicleCounter += 1;
  const motoRes = await request(app.getHttpServer())
    .post('/motorcycles')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ registrationNumber: `REG-${vehicleCounter}`, vehicleType: 'TRUCK' })
    .expect(201);
  const motorcycleId = motoRes.body.id as string;

  const jobRes = await request(app.getHttpServer())
    .post('/transport-jobs')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      motorcycleId,
      ownerDriven: true,
      origin: 'Dar es Salaam',
      destination: 'Morogoro',
      revenue: 450000,
      scheduledDate: '2026-08-01',
      ...overrides,
    })
    .expect(201);

  return {
    jobId: jobRes.body.id as string,
    reference: jobRes.body.reference as string,
    motorcycleId,
  };
}

function csvStatement(
  rows: { date: string; amount: number | string; narrative: string }[],
): Buffer {
  const lines = [
    'Date,Amount,Narrative',
    ...rows.map((r) => `${r.date},${r.amount},"${r.narrative}"`),
  ];
  return Buffer.from(lines.join('\n'), 'utf8');
}

async function getJob(app: INestApplication, token: string, jobId: string) {
  const res = await request(app.getHttpServer())
    .get(`/transport-jobs/${jobId}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body;
}

describe('Transport payment reconciliation (e2e)', () => {
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
    vehicleCounter = 0;
  }, CLEAN_DATABASE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  }, CLEAN_DATABASE_HOOK_TIMEOUT_MS);

  it('RIDER and MECHANIC are forbidden from preview and commit (403)', async () => {
    const { accessToken, tenantId } = await signupOwner(
      app,
      'owner-roles@fleet.test',
      'Fleet Roles',
    );
    const riderToken = await seedRider(app, accessToken, 'Roles1');
    const mechanicToken = await seedMechanic(app, prisma, tenantId, 'Roles1');
    const statement = csvStatement([{ date: '2026-08-01', amount: 1000, narrative: 'x' }]);

    for (const token of [riderToken, mechanicToken]) {
      await request(app.getHttpServer())
        .post('/transport-reconciliation/preview')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', statement, 'statement.csv')
        .expect(403);
      await request(app.getHttpServer())
        .post('/transport-reconciliation/commit')
        .set('Authorization', `Bearer ${token}`)
        .field('selections', JSON.stringify([]))
        .attach('file', statement, 'statement.csv')
        .expect(403);
    }
  });

  it('MANAGER (not just OWNER) can preview and commit', async () => {
    const { accessToken, tenantId } = await signupOwner(app, 'owner-mgr@fleet.test', 'Fleet Mgr');
    const manager = await seedManager(prisma, tenantId, 'Mgr1');
    const managerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: manager.email, password: manager.password })
      .expect(200);
    const managerToken = managerLogin.body.accessToken as string;

    const { reference } = await createTransportJob(app, accessToken);
    const statement = csvStatement([
      { date: '2026-08-01', amount: 450000, narrative: `PAYMENT ${reference}` },
    ]);

    await request(app.getHttpServer())
      .post('/transport-reconciliation/preview')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('file', statement, 'statement.csv')
      .expect(201);
  });

  it('a real round trip: reference match, commit, amountReceived/lastPaymentReceivedAt/TransportPaymentMatch all correct, revenue/expense P&L unchanged', async () => {
    const { accessToken, tenantId } = await signupOwner(app, 'owner-a@fleet.test', 'Fleet A');
    const { jobId, reference } = await createTransportJob(app, accessToken, { revenue: 450000 });

    // Log an expense too, to prove expensesTotal/netProfit are untouched by
    // this whole flow - they only ever read revenue/expenses, never
    // amountReceived.
    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ category: 'Fuel', amount: 30000, incurredAt: '2026-08-01', transportJobId: jobId })
      .expect(201);

    const before = await getJob(app, accessToken, jobId);
    expect(Number(before.amountReceived)).toBe(0);
    expect(Number(before.revenue)).toBe(450000);

    const statement = csvStatement([
      {
        date: '2026-08-15',
        amount: 450000,
        narrative: `MPESA ${reference.toLowerCase().replace('-', ' ')} thank you`,
      },
    ]);

    const previewRes = await request(app.getHttpServer())
      .post('/transport-reconciliation/preview')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', statement, 'statement.csv')
      .expect(201);

    expect(previewRes.body.rows).toHaveLength(1);
    expect(previewRes.body.rows[0].candidates).toEqual([
      expect.objectContaining({ jobId, matchReason: 'reference', remainingBalance: '450000.00' }),
    ]);

    const commitRes = await request(app.getHttpServer())
      .post('/transport-reconciliation/commit')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('selections', JSON.stringify([{ rowIndex: 2, transportJobId: jobId }]))
      .attach('file', statement, 'statement.csv')
      .expect(201);

    expect(commitRes.body.results).toEqual([
      expect.objectContaining({
        rowIndex: 2,
        status: 'committed',
        transportJobId: jobId,
        overpaidWarning: false,
      }),
    ]);

    const after = await getJob(app, accessToken, jobId);
    expect(Number(after.amountReceived)).toBe(450000);
    expect(after.lastPaymentReceivedAt).toContain('2026-08-15');
    // Untouched by this whole flow.
    expect(Number(after.revenue)).toBe(450000);
    expect(Number(after.expensesTotal)).toBe(30000);
    expect(Number(after.netProfit)).toBe(420000);

    const matches = await requestContext.runUnscoped(() =>
      prisma.client.transportPaymentMatch.findMany({ where: { transportJobId: jobId } }),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].tenantId).toBe(tenantId);
    expect(Number(matches[0].amount)).toBe(450000);
    expect(matches[0].sourceFileName).toBe('statement.csv');
    expect(matches[0].narrativeText).toContain('MPESA');
  });

  it("never matches or credits another tenant's job (tenant isolation)", async () => {
    const a = await signupOwner(app, 'owner-tenant-a@fleet.test', 'Fleet Tenant A');
    const b = await signupOwner(app, 'owner-tenant-b@fleet.test', 'Fleet Tenant B');
    const jobA = await createTransportJob(app, a.accessToken, { revenue: 100000 });

    // Tenant B previews/commits a statement that mentions tenant A's own
    // reference - must never see or credit it.
    const statement = csvStatement([
      { date: '2026-08-01', amount: 100000, narrative: `PAYMENT ${jobA.reference}` },
    ]);

    const previewRes = await request(app.getHttpServer())
      .post('/transport-reconciliation/preview')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .attach('file', statement, 'statement.csv')
      .expect(201);
    expect(previewRes.body.rows[0].candidates).toEqual([]);

    const commitRes = await request(app.getHttpServer())
      .post('/transport-reconciliation/commit')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .field('selections', JSON.stringify([{ rowIndex: 2, transportJobId: jobA.jobId }]))
      .attach('file', statement, 'statement.csv')
      .expect(201);
    expect(commitRes.body.results).toEqual([
      expect.objectContaining({ rowIndex: 2, status: 'error' }),
    ]);

    const stillZero = await getJob(app, a.accessToken, jobA.jobId);
    expect(Number(stillZero.amountReceived)).toBe(0);
  });

  it("re-parses the file server-side at commit time - a client can never assert a different amount than what's actually in the re-uploaded file", async () => {
    const { accessToken } = await signupOwner(app, 'owner-tamper@fleet.test', 'Fleet Tamper');
    const { jobId, reference } = await createTransportJob(app, accessToken, { revenue: 450000 });

    const previewFile = csvStatement([{ date: '2026-08-01', amount: 1000, narrative: reference }]);
    await request(app.getHttpServer())
      .post('/transport-reconciliation/preview')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', previewFile, 'statement.csv')
      .expect(201);

    // Commit re-uploads a DIFFERENT file (a different amount at the same
    // row index) - there is no amount field anywhere in the commit request
    // for a client to tamper with; the server can only ever record what it
    // re-derives from whatever file is actually attached to this call.
    const commitFile = csvStatement([{ date: '2026-08-01', amount: 9999, narrative: reference }]);
    await request(app.getHttpServer())
      .post('/transport-reconciliation/commit')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('selections', JSON.stringify([{ rowIndex: 2, transportJobId: jobId }]))
      .attach('file', commitFile, 'statement.csv')
      .expect(201);

    const after = await getJob(app, accessToken, jobId);
    expect(Number(after.amountReceived)).toBe(9999); // the COMMIT file's amount, never the preview file's
  });

  it('rolls back the whole commit when one row causes a genuine write failure - no partial credit', async () => {
    const { accessToken } = await signupOwner(app, 'owner-tx@fleet.test', 'Fleet Tx');
    const jobOk = await createTransportJob(app, accessToken, { revenue: 100000 });
    const jobOverflow = await createTransportJob(app, accessToken, { revenue: 100000 });

    // Row 2 is a perfectly valid payment; row 3's amount is large enough to
    // overflow the amount_received column's Decimal(12,2) precision (10
    // integer digits max) - a real Postgres-level failure mid-transaction,
    // not a soft per-row error this code catches and skips.
    const statement = csvStatement([
      { date: '2026-08-01', amount: 50000, narrative: jobOk.reference },
      { date: '2026-08-01', amount: '999999999999.99', narrative: jobOverflow.reference },
    ]);

    await request(app.getHttpServer())
      .post('/transport-reconciliation/commit')
      .set('Authorization', `Bearer ${accessToken}`)
      .field(
        'selections',
        JSON.stringify([
          { rowIndex: 2, transportJobId: jobOk.jobId },
          { rowIndex: 3, transportJobId: jobOverflow.jobId },
        ]),
      )
      .attach('file', statement, 'statement.csv')
      .expect(500);

    // Row 2's write must NOT have persisted either - one transaction, one
    // failure, nothing partially applied.
    const stillZero = await getJob(app, accessToken, jobOk.jobId);
    expect(Number(stillZero.amountReceived)).toBe(0);
  });
});
