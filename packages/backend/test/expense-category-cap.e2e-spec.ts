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
    })
    .expect(201);
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: 'riderpass123' })
    .expect(200);
  return res.body.accessToken as string;
}

const ALL_SEVEN = ['Fuel', 'Repairs', 'Spare parts', 'Puncture', 'Wash', 'Parking', 'Other'];

describe('Expense category caps (e2e)', () => {
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

  it('GET always returns all 7 categories, in the fixed order, null where nothing is configured', async () => {
    const { accessToken } = await signupOwner(app, 'owner-empty@fleet.test', 'Fleet Empty');
    const res = await request(app.getHttpServer())
      .get('/expense-category-caps')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.map((c: { category: string }) => c.category)).toEqual(ALL_SEVEN);
    expect(res.body.every((c: { dailyCapAmount: unknown }) => c.dailyCapAmount === null)).toBe(
      true,
    );
  });

  it('OWNER can PUT a subset, GET reflects it, and a category left out stays untouched', async () => {
    const { accessToken } = await signupOwner(app, 'owner-put@fleet.test', 'Fleet Put');

    await request(app.getHttpServer())
      .put('/expense-category-caps')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ caps: [{ category: 'Fuel', dailyCapAmount: 20000 }] })
      .expect(200);

    let res = await request(app.getHttpServer())
      .get('/expense-category-caps')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const byCategory = (body: { category: string; dailyCapAmount: string | null }[]) =>
      new Map(body.map((c) => [c.category, c.dailyCapAmount]));
    expect(byCategory(res.body).get('Fuel')).toBe('20000.00');
    expect(byCategory(res.body).get('Repairs')).toBeNull();

    // A second PUT touching a different category must not clear Fuel's cap.
    await request(app.getHttpServer())
      .put('/expense-category-caps')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ caps: [{ category: 'Repairs', dailyCapAmount: 5000 }] })
      .expect(200);

    res = await request(app.getHttpServer())
      .get('/expense-category-caps')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(byCategory(res.body).get('Fuel')).toBe('20000.00');
    expect(byCategory(res.body).get('Repairs')).toBe('5000.00');
  });

  it('a null dailyCapAmount clears an existing cap entirely', async () => {
    const { accessToken } = await signupOwner(app, 'owner-clear@fleet.test', 'Fleet Clear');
    await request(app.getHttpServer())
      .put('/expense-category-caps')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ caps: [{ category: 'Fuel', dailyCapAmount: 20000 }] })
      .expect(200);

    await request(app.getHttpServer())
      .put('/expense-category-caps')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ caps: [{ category: 'Fuel', dailyCapAmount: null }] })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/expense-category-caps')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const fuel = res.body.find((c: { category: string }) => c.category === 'Fuel');
    expect(fuel.dailyCapAmount).toBeNull();
  });

  it('an invalid category is rejected with 400', async () => {
    const { accessToken } = await signupOwner(app, 'owner-badcat@fleet.test', 'Fleet BadCat');
    await request(app.getHttpServer())
      .put('/expense-category-caps')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ caps: [{ category: 'Insurance', dailyCapAmount: 1000 }] })
      .expect(400);
  });

  it('a zero or negative dailyCapAmount is rejected with 400', async () => {
    const { accessToken } = await signupOwner(app, 'owner-badamt@fleet.test', 'Fleet BadAmt');
    await request(app.getHttpServer())
      .put('/expense-category-caps')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ caps: [{ category: 'Fuel', dailyCapAmount: 0 }] })
      .expect(400);
    await request(app.getHttpServer())
      .put('/expense-category-caps')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ caps: [{ category: 'Fuel', dailyCapAmount: -500 }] })
      .expect(400);
  });

  it('RIDER is forbidden from both GET and PUT; MANAGER can GET but is forbidden from PUT', async () => {
    const { accessToken, tenantId } = await signupOwner(
      app,
      'owner-roles@fleet.test',
      'Fleet Roles',
    );
    const manager = await seedManager(prisma, tenantId, 'Roles1');
    const managerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: manager.email, password: manager.password })
      .expect(200);
    const managerToken = managerLogin.body.accessToken as string;
    const riderToken = await seedRider(app, accessToken, 'Roles1');

    await request(app.getHttpServer())
      .get('/expense-category-caps')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .put('/expense-category-caps')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ caps: [{ category: 'Fuel', dailyCapAmount: 1000 }] })
      .expect(403);

    await request(app.getHttpServer())
      .get('/expense-category-caps')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .put('/expense-category-caps')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ caps: [{ category: 'Fuel', dailyCapAmount: 1000 }] })
      .expect(403);
  });

  it("isolates caps across tenants - tenant B never sees or can touch tenant A's caps", async () => {
    const a = await signupOwner(app, 'owner-tenant-a@fleet.test', 'Fleet Tenant A');
    await request(app.getHttpServer())
      .put('/expense-category-caps')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ caps: [{ category: 'Fuel', dailyCapAmount: 15000 }] })
      .expect(200);

    const b = await signupOwner(app, 'owner-tenant-b@fleet.test', 'Fleet Tenant B');
    const bRes = await request(app.getHttpServer())
      .get('/expense-category-caps')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    const bFuel = bRes.body.find((c: { category: string }) => c.category === 'Fuel');
    expect(bFuel.dailyCapAmount).toBeNull();

    // B setting Fuel must not affect A's own cap.
    await request(app.getHttpServer())
      .put('/expense-category-caps')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .send({ caps: [{ category: 'Fuel', dailyCapAmount: 999 }] })
      .expect(200);

    const aRes = await request(app.getHttpServer())
      .get('/expense-category-caps')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
    const aFuel = aRes.body.find((c: { category: string }) => c.category === 'Fuel');
    expect(aFuel.dailyCapAmount).toBe('15000.00');
  });
});
