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

describe('Tenant settings (e2e, Stage G Part 2)', () => {
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
      email: 'owner@settings-fleet.test',
      password: 'password123',
      companyName: 'Settings Fleet',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '+254700000401',
      ...overrides,
    };
    const res = await request(app.getHttpServer()).post('/auth/signup').send(body).expect(201);
    return { accessToken: res.body.accessToken as string };
  }

  it('GET returns null physicalAddress/directorName for a freshly signed-up tenant', async () => {
    const { accessToken } = await signupOwner();

    const res = await request(app.getHttpServer())
      .get('/tenant/settings')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toEqual({
      name: 'Settings Fleet',
      physicalAddress: null,
      directorName: null,
    });
  });

  it('PATCH sets physicalAddress and directorName, and GET reflects the change', async () => {
    const { accessToken } = await signupOwner();

    await request(app.getHttpServer())
      .patch('/tenant/settings')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ physicalAddress: 'Uhuru Street, Dar es Salaam', directorName: 'Amina Said' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/tenant/settings')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.physicalAddress).toBe('Uhuru Street, Dar es Salaam');
    expect(res.body.directorName).toBe('Amina Said');
  });

  it('rejects a MANAGER with 403 on both GET and PATCH - OWNER only, no exception', async () => {
    const { accessToken: ownerToken } = await signupOwner();
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const passwordHash = await hashPassword('password123');
    await requestContext.runUnscoped(() =>
      prisma.client.user.create({
        data: {
          tenantId: me.body.tenantId,
          email: 'manager@settings-fleet.test',
          phone: '+254700000402',
          passwordHash,
          role: UserRole.MANAGER,
          firstName: 'Man',
          lastName: 'Ager',
        },
      }),
    );
    const managerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'manager@settings-fleet.test', password: 'password123' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/tenant/settings')
      .set('Authorization', `Bearer ${managerLogin.body.accessToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .patch('/tenant/settings')
      .set('Authorization', `Bearer ${managerLogin.body.accessToken}`)
      .send({ physicalAddress: 'x' })
      .expect(403);
  });
});
