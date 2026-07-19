import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanDatabase } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';

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
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

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

    // Update then delete.
    const id = filtered.body[0].id as string;
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
});
