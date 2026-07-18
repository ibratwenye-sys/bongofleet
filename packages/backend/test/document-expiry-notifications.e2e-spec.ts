import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailerService } from '../src/modules/notification/mailer.service';
import { DocumentExpiryNotificationService } from '../src/modules/notification/document-expiry-notification.service';
import { requestContext } from '../src/common/context/request-context';
import { cleanDatabase } from './utils/prisma-test.util';
import { createTestApp } from './utils/create-test-app';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

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
  return { accessToken: res.body.accessToken as string };
}

async function createMotorcycle(app: INestApplication, token: string, reg: string) {
  const res = await request(app.getHttpServer())
    .post('/motorcycles')
    .set('Authorization', `Bearer ${token}`)
    .send({ registrationNumber: reg })
    .expect(201);
  return res.body.id as string;
}

async function uploadDocument(
  app: INestApplication,
  token: string,
  motorcycleId: string,
  docType: string,
  expiryDate: string,
) {
  const res = await request(app.getHttpServer())
    .post('/documents')
    .set('Authorization', `Bearer ${token}`)
    .field('ownerType', 'MOTORCYCLE')
    .field('ownerId', motorcycleId)
    .field('docType', docType)
    .field('expiryDate', expiryDate)
    .attach('file', TINY_PNG, 'doc.png')
    .expect(201);
  return res.body.id as string;
}

describe('Document expiry notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mailer: MailerService;
  let scanner: DocumentExpiryNotificationService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = await createTestApp(moduleFixture);
    prisma = moduleFixture.get(PrismaService);
    mailer = moduleFixture.get(MailerService);
    scanner = moduleFixture.get(DocumentExpiryNotificationService);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  it('emails each tenant only its own expiring documents, records alerts, and never repeats them', async () => {
    const sendSpy = jest.spyOn(mailer, 'send');

    // Tenant A: one expired + one expiring-soon + one far-future document.
    const a = await signupOwner(app, 'owner-a@fleet-a.test', 'Fleet A');
    const motoA = await createMotorcycle(app, a.accessToken, 'KDA-100A');
    await uploadDocument(app, a.accessToken, motoA, 'INSURANCE', isoDaysFromNow(-5));
    await uploadDocument(app, a.accessToken, motoA, 'LATRA', isoDaysFromNow(10));
    await uploadDocument(app, a.accessToken, motoA, 'TBS_CERTIFICATE', isoDaysFromNow(200));

    // Tenant B: only a far-future document - must receive nothing.
    const b = await signupOwner(app, 'owner-b@fleet-b.test', 'Fleet B');
    const motoB = await createMotorcycle(app, b.accessToken, 'KDB-200B');
    await uploadDocument(app, b.accessToken, motoB, 'INSURANCE', isoDaysFromNow(300));

    // First scan: tenant A gets one digest with exactly its two urgent documents.
    const first = await scanner.scanAndNotify();
    expect(first.tenantsScanned).toBe(2);
    expect(first.tenantsNotified).toBe(1);
    expect(first.alertsSent).toBe(2);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const digest = sendSpy.mock.calls[0][0];
    expect(digest.to).toEqual(['owner-a@fleet-a.test']);
    expect(digest.text).toContain('KDA-100A');
    expect(digest.text).toContain('INSURANCE');
    expect(digest.text).toContain('LATRA');
    // Tenant isolation + horizon: no cross-tenant or far-future leakage.
    expect(digest.text).not.toContain('KDB-200B');
    expect(digest.text).not.toContain('TBS');

    // Alerts recorded with the right kinds.
    const alerts = await requestContext.runUnscoped(() =>
      prisma.client.documentAlert.findMany({ orderBy: { kind: 'asc' } }),
    );
    expect(alerts).toHaveLength(2);
    expect(alerts.map((alert) => alert.kind).sort()).toEqual(['EXPIRED', 'EXPIRING_SOON']);

    // Second scan: nothing new - nobody is emailed twice about the same thing.
    sendSpy.mockClear();
    const second = await scanner.scanAndNotify();
    expect(second.tenantsNotified).toBe(0);
    expect(second.alertsSent).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('re-alerts a renewed (re-uploaded) document because it is a new document row', async () => {
    const sendSpy = jest.spyOn(mailer, 'send');

    const a = await signupOwner(app, 'owner-c@fleet-c.test', 'Fleet C');
    const moto = await createMotorcycle(app, a.accessToken, 'KDC-300C');
    const expiredDocId = await uploadDocument(
      app,
      a.accessToken,
      moto,
      'INSURANCE',
      isoDaysFromNow(-1),
    );

    await scanner.scanAndNotify();
    expect(sendSpy).toHaveBeenCalledTimes(1);

    // Owner renews: deletes the expired document and uploads the new policy,
    // which unfortunately is again about to expire.
    await request(app.getHttpServer())
      .delete(`/documents/${expiredDocId}`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(204);
    await uploadDocument(app, a.accessToken, moto, 'INSURANCE', isoDaysFromNow(3));

    sendSpy.mockClear();
    const rescan = await scanner.scanAndNotify();
    expect(rescan.alertsSent).toBe(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    // The old document's alert row was cascade-deleted with the document.
    const alerts = await requestContext.runUnscoped(() => prisma.client.documentAlert.findMany());
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe('EXPIRING_SOON');
  });
});
