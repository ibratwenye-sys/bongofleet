import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanDatabase } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const signupBody = {
    email: 'owner@acme-fleet.test',
    password: 'password123',
    companyName: 'Acme Fleet',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '+254700000001',
  };

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

  it('signs up, logs in, reads /me, refreshes, and logs out', async () => {
    const signupRes = await request(app.getHttpServer())
      .post('/auth/signup')
      .send(signupBody)
      .expect(201);

    expect(signupRes.body.accessToken).toBeDefined();
    expect(signupRes.body.refreshToken).toBeDefined();

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: signupBody.email, password: signupBody.password })
      .expect(200);

    const { accessToken, refreshToken } = loginRes.body;

    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(meRes.body.email).toBe(signupBody.email);
    expect(meRes.body.role).toBe('OWNER');
    expect(meRes.body.passwordHash).toBeUndefined();

    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    expect(refreshRes.body.accessToken).toBeDefined();
    expect(refreshRes.body.refreshToken).not.toBe(refreshToken);

    // Reusing the rotated-out refresh token must fail
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken }).expect(401);

    const newAccessToken = refreshRes.body.accessToken;
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${newAccessToken}`)
      .expect(204);

    // The refresh token issued alongside the now-logged-out access token is dead
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshRes.body.refreshToken })
      .expect(401);
  });

  it('rejects login with the wrong password', async () => {
    await request(app.getHttpServer()).post('/auth/signup').send(signupBody).expect(201);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: signupBody.email, password: 'wrong-password' })
      .expect(401);
  });

  it('rejects signup with a duplicate email', async () => {
    await request(app.getHttpServer()).post('/auth/signup').send(signupBody).expect(201);

    await request(app.getHttpServer()).post('/auth/signup').send(signupBody).expect(409);
  });

  it('rejects /me with no token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });
});
