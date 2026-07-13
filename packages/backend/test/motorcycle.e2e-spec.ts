import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/modules/auth/utils/password.util';
import { cleanDatabase } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';

async function signupOwner(app: INestApplication, overrides: Partial<Record<string, string>> = {}) {
  const body = {
    email: 'owner@acme-fleet.test',
    password: 'password123',
    companyName: 'Acme Fleet',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '+254700000001',
    ...overrides,
  };
  const res = await request(app.getHttpServer()).post('/auth/signup').send(body).expect(201);
  const me = await request(app.getHttpServer())
    .get('/auth/me')
    .set('Authorization', `Bearer ${res.body.accessToken}`)
    .expect(200);
  return { accessToken: res.body.accessToken as string, tenantId: me.body.tenantId as string };
}

async function seedRider(prisma: PrismaService, tenantId: string) {
  const user = await prisma.client.user.create({
    data: {
      tenantId,
      email: 'rider1@acme-fleet.test',
      phone: '+254710000001',
      passwordHash: await hashPassword('password123'),
      role: UserRole.RIDER,
      firstName: 'Riri',
      lastName: 'Der',
    },
  });
  return { email: 'rider1@acme-fleet.test', password: 'password123', userId: user.id };
}

describe('Motorcycle (e2e)', () => {
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

  it('creates, lists, updates, and deactivates a motorcycle', async () => {
    const { accessToken } = await signupOwner(app);

    const createRes = await request(app.getHttpServer())
      .post('/motorcycles')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ registrationNumber: '  KDA-001A  ', make: 'Honda', model: 'CB125' })
      .expect(201);

    expect(createRes.body.registrationNumber).toBe('KDA-001A'); // trimmed
    expect(createRes.body.status).toBe('ACTIVE');

    const listRes = await request(app.getHttpServer())
      .get('/motorcycles')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listRes.body).toHaveLength(1);

    const updateRes = await request(app.getHttpServer())
      .patch(`/motorcycles/${createRes.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'MAINTENANCE' })
      .expect(200);
    expect(updateRes.body.status).toBe('MAINTENANCE');

    await request(app.getHttpServer())
      .delete(`/motorcycles/${createRes.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const listAfterDeactivate = await request(app.getHttpServer())
      .get('/motorcycles')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listAfterDeactivate.body).toHaveLength(0);

    // still fetchable directly, history intact
    await request(app.getHttpServer())
      .get(`/motorcycles/${createRes.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('rejects a duplicate registrationNumber', async () => {
    const { accessToken } = await signupOwner(app);

    await request(app.getHttpServer())
      .post('/motorcycles')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ registrationNumber: 'KDA-002B' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/motorcycles')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ registrationNumber: 'KDA-002B' })
      .expect(409);
  });

  it("enforces tenant isolation: a second tenant cannot see or fetch the first tenant's motorcycles", async () => {
    const { accessToken: ownerAToken } = await signupOwner(app);

    const createRes = await request(app.getHttpServer())
      .post('/motorcycles')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ registrationNumber: 'KDA-003C' })
      .expect(201);

    const { accessToken: ownerBToken } = await signupOwner(app, {
      email: 'owner-b@other-fleet.test',
      companyName: 'Other Fleet',
      phone: '+254700000099',
    });

    const listRes = await request(app.getHttpServer())
      .get('/motorcycles')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(200);
    expect(listRes.body).toHaveLength(0);

    await request(app.getHttpServer())
      .get(`/motorcycles/${createRes.body.id}`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(404);
  });

  it('gets a clean 403 when a RIDER attempts to create a motorcycle', async () => {
    const { tenantId } = await signupOwner(app);
    const { email, password } = await seedRider(prisma, tenantId);

    const riderLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    await request(app.getHttpServer())
      .post('/motorcycles')
      .set('Authorization', `Bearer ${riderLogin.body.accessToken}`)
      .send({ registrationNumber: 'KDA-004D' })
      .expect(403);
  });
});
