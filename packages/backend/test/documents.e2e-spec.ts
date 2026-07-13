import { promises as fs } from 'node:fs';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanDatabase } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';

// A minimal valid 1x1 transparent PNG, used as real (not fake) image bytes for
// the upload/download round-trip assertion below.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function bufferParser(res: request.Response, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

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
  return { accessToken: res.body.accessToken as string };
}

describe('Documents & Guarantors (e2e)', () => {
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
    await fs.rm(process.env.UPLOADS_DIR ?? './uploads', { recursive: true, force: true });
  });

  it('uploads, lists, downloads, and tracks expiry for documents; manages guarantors; enforces tenant isolation', async () => {
    const { accessToken } = await signupOwner(app);

    const riderRes = await request(app.getHttpServer())
      .post('/riders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Riri',
        lastName: 'Der',
        phone: '+254710000001',
        email: 'rider1@acme-fleet.test',
        licenseNumber: 'LIC-E2E-1',
        initialPassword: 'riderpass123',
      })
      .expect(201);
    const riderId = riderRes.body.id as string;

    const motoRes = await request(app.getHttpServer())
      .post('/motorcycles')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ registrationNumber: 'KDA-E2E-1' })
      .expect(201);
    const motorcycleId = motoRes.body.id as string;

    // --- upload a document for the rider ---
    const uploadRes = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('ownerType', 'RIDER')
      .field('ownerId', riderId)
      .field('docType', 'NATIONAL_ID')
      .attach('file', TINY_PNG, { filename: 'id-card.png', contentType: 'image/png' })
      .expect(201);
    expect(uploadRes.body.fileName).toBe('id-card.png');
    expect(uploadRes.body.mimeType).toBe('image/png');
    const riderDocumentId = uploadRes.body.id as string;

    // --- upload a document for the motorcycle, with a near-term expiry ---
    const inTenDays = new Date();
    inTenDays.setUTCDate(inTenDays.getUTCDate() + 10);
    await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('ownerType', 'MOTORCYCLE')
      .field('ownerId', motorcycleId)
      .field('docType', 'INSURANCE')
      .field('expiryDate', inTenDays.toISOString().slice(0, 10))
      .attach('file', TINY_PNG, { filename: 'insurance.png', contentType: 'image/png' })
      .expect(201);

    // --- list by owner ---
    const listRes = await request(app.getHttpServer())
      .get('/documents')
      .query({ ownerType: 'RIDER', ownerId: riderId })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].id).toBe(riderDocumentId);

    // --- download and confirm the bytes round-trip exactly ---
    const downloadRes = await request(app.getHttpServer())
      .get(`/documents/${riderDocumentId}/file`)
      .set('Authorization', `Bearer ${accessToken}`)
      .buffer()
      .parse(bufferParser)
      .expect(200);
    expect(Buffer.compare(downloadRes.body as Buffer, TINY_PNG)).toBe(0);
    expect(downloadRes.headers['content-type']).toBe('image/png');

    // --- expiry tracking ---
    const expiringRes = await request(app.getHttpServer())
      .get('/documents/expiring')
      .query({ withinDays: 30 })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(expiringRes.body).toHaveLength(1);
    expect(expiringRes.body[0].status).toBe('EXPIRING_SOON');
    expect(expiringRes.body[0].ownerType).toBe('MOTORCYCLE');
    expect(expiringRes.body[0].ownerLabel).toBe('KDA-E2E-1');

    // --- a disallowed file type is rejected cleanly ---
    await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('ownerType', 'RIDER')
      .field('ownerId', riderId)
      .field('docType', 'OTHER')
      .attach('file', Buffer.from('not an image'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      })
      .expect(400);

    // --- guarantors: add two, list them ---
    await request(app.getHttpServer())
      .post(`/riders/${riderId}/guarantors`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Grace', lastName: 'Guarantor', phone: '+254700000123' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/riders/${riderId}/guarantors`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Gabriel', lastName: 'Guarantor', phone: '+254700000124' })
      .expect(201);

    const guarantorsRes = await request(app.getHttpServer())
      .get(`/riders/${riderId}/guarantors`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(guarantorsRes.body).toHaveLength(2);

    // --- tenant isolation: a second tenant cannot download the first tenant's file ---
    const { accessToken: otherOwnerToken } = await signupOwner(app, {
      email: 'owner-b@other-fleet.test',
      companyName: 'Other Fleet',
      phone: '+254700000099',
    });
    await request(app.getHttpServer())
      .get(`/documents/${riderDocumentId}/file`)
      .set('Authorization', `Bearer ${otherOwnerToken}`)
      .expect(404);
  });
});
