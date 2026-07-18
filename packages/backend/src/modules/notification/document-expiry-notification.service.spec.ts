import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DocumentAlertKind, DocumentOwnerType, DocumentType } from '@prisma/client';
import { DocumentExpiryNotificationService } from './document-expiry-notification.service';
import { MailerService } from './mailer.service';
import { DocumentService } from '../document/document.service';
import { PrismaService } from '../../prisma/prisma.service';

// Fixed "now" so date math in the specs is deterministic: 2026-07-18 UTC.
const NOW = new Date('2026-07-18T09:00:00.000Z');

function daysFromNow(days: number): Date {
  const date = new Date(Date.UTC(2026, 6, 18));
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function makeDocument(
  overrides: Partial<{
    id: string;
    ownerType: DocumentOwnerType;
    ownerId: string;
    docType: DocumentType;
    referenceNumber: string | null;
    expiryDate: Date | null;
    alerts: Array<{ kind: DocumentAlertKind }>;
  }> = {},
) {
  return {
    id: 'doc-1',
    tenantId: 'tenant-1',
    ownerType: DocumentOwnerType.MOTORCYCLE,
    ownerId: 'moto-1',
    docType: DocumentType.INSURANCE,
    referenceNumber: 'INS-1',
    expiryDate: daysFromNow(10),
    fileName: 'insurance.pdf',
    mimeType: 'application/pdf',
    storageKey: 'tenant-1/insurance.pdf',
    sizeBytes: 100,
    uploadedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    alerts: [] as Array<{ kind: DocumentAlertKind }>,
    ...overrides,
  };
}

describe('DocumentExpiryNotificationService', () => {
  let service: DocumentExpiryNotificationService;
  let prisma: {
    client: {
      tenant: { findMany: jest.Mock };
      document: { findMany: jest.Mock };
      user: { findMany: jest.Mock };
      documentAlert: { createMany: jest.Mock };
    };
  };
  let mailer: { send: jest.Mock };
  let documentService: { buildOwnerLabels: jest.Mock };
  let schedulerRegistry: { addCronJob: jest.Mock };

  const tenant = { id: 'tenant-1', name: 'Acme Fleet', contactEmail: null as string | null };

  beforeEach(async () => {
    prisma = {
      client: {
        tenant: { findMany: jest.fn().mockResolvedValue([tenant]) },
        document: { findMany: jest.fn().mockResolvedValue([]) },
        user: {
          findMany: jest.fn().mockResolvedValue([{ email: 'owner@acme.test' }]),
        },
        documentAlert: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      },
    };
    mailer = { send: jest.fn().mockResolvedValue(true) };
    documentService = { buildOwnerLabels: jest.fn().mockResolvedValue(new Map()) };
    schedulerRegistry = { addCronJob: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentExpiryNotificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailerService, useValue: mailer },
        { provide: DocumentService, useValue: documentService },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => {
              if (key === 'NODE_ENV') return 'test';
              return fallback;
            }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(DocumentExpiryNotificationService);
  });

  it('does not self-schedule a cron job in the test environment', () => {
    service.onModuleInit();
    expect(schedulerRegistry.addCronJob).not.toHaveBeenCalled();
  });

  it('sends one digest per tenant and records one alert per document+kind', async () => {
    prisma.client.document.findMany.mockResolvedValue([
      makeDocument({ id: 'doc-expired', expiryDate: daysFromNow(-3), referenceNumber: null }),
      makeDocument({
        id: 'doc-soon',
        ownerType: DocumentOwnerType.RIDER,
        ownerId: 'rider-1',
        docType: DocumentType.DRIVERS_LICENSE,
        expiryDate: daysFromNow(10),
      }),
    ]);
    documentService.buildOwnerLabels.mockResolvedValue(
      new Map([
        ['MOTORCYCLE:moto-1', 'KDA-123'],
        ['RIDER:rider-1', 'Juma Rider'],
      ]),
    );

    const result = await service.scanAndNotify(NOW);

    expect(result).toEqual({ tenantsScanned: 1, tenantsNotified: 1, alertsSent: 2 });
    expect(mailer.send).toHaveBeenCalledTimes(1);

    const message = mailer.send.mock.calls[0][0];
    expect(message.to).toEqual(['owner@acme.test']);
    expect(message.subject).toContain('2 document(s)');
    expect(message.text).toContain('EXPIRED:');
    expect(message.text).toContain('KDA-123');
    expect(message.text).toContain('EXPIRING WITHIN 30 DAYS:');
    expect(message.text).toContain('Juma Rider');

    expect(prisma.client.documentAlert.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          tenantId: 'tenant-1',
          documentId: 'doc-expired',
          kind: DocumentAlertKind.EXPIRED,
        }),
        expect.objectContaining({
          tenantId: 'tenant-1',
          documentId: 'doc-soon',
          kind: DocumentAlertKind.EXPIRING_SOON,
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('skips documents already alerted for the same kind, but escalates to EXPIRED', async () => {
    prisma.client.document.findMany.mockResolvedValue([
      // Already alerted as expiring-soon and still only expiring-soon: no new alert.
      makeDocument({
        id: 'doc-already',
        expiryDate: daysFromNow(5),
        alerts: [{ kind: DocumentAlertKind.EXPIRING_SOON }],
      }),
      // Alerted as expiring-soon earlier, has now expired: escalates to EXPIRED.
      makeDocument({
        id: 'doc-escalated',
        expiryDate: daysFromNow(-1),
        alerts: [{ kind: DocumentAlertKind.EXPIRING_SOON }],
      }),
    ]);

    const result = await service.scanAndNotify(NOW);

    expect(result.alertsSent).toBe(1);
    expect(prisma.client.documentAlert.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ documentId: 'doc-escalated', kind: DocumentAlertKind.EXPIRED }),
        ],
      }),
    );
  });

  it('sends nothing and records nothing when every document is quiet', async () => {
    prisma.client.document.findMany.mockResolvedValue([
      makeDocument({ alerts: [{ kind: DocumentAlertKind.EXPIRING_SOON }] }),
    ]);

    const result = await service.scanAndNotify(NOW);

    expect(result.tenantsNotified).toBe(0);
    expect(mailer.send).not.toHaveBeenCalled();
    expect(prisma.client.documentAlert.createMany).not.toHaveBeenCalled();
  });

  it('does not record alerts when the email fails, so the next run retries', async () => {
    prisma.client.document.findMany.mockResolvedValue([
      makeDocument({ expiryDate: daysFromNow(-2) }),
    ]);
    mailer.send.mockResolvedValue(false);

    const result = await service.scanAndNotify(NOW);

    expect(result.alertsSent).toBe(0);
    expect(prisma.client.documentAlert.createMany).not.toHaveBeenCalled();
  });

  it('skips a tenant with no recipients instead of recording unsent alerts', async () => {
    prisma.client.document.findMany.mockResolvedValue([
      makeDocument({ expiryDate: daysFromNow(-2) }),
    ]);
    prisma.client.user.findMany.mockResolvedValue([]);

    const result = await service.scanAndNotify(NOW);

    expect(result.alertsSent).toBe(0);
    expect(mailer.send).not.toHaveBeenCalled();
    expect(prisma.client.documentAlert.createMany).not.toHaveBeenCalled();
  });

  it('falls back to the tenant contact email when no owner user exists', async () => {
    prisma.client.tenant.findMany.mockResolvedValue([
      { ...tenant, contactEmail: 'Boss@Acme.Test' },
    ]);
    prisma.client.document.findMany.mockResolvedValue([
      makeDocument({ expiryDate: daysFromNow(-2) }),
    ]);
    prisma.client.user.findMany.mockResolvedValue([]);

    await service.scanAndNotify(NOW);

    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(mailer.send.mock.calls[0][0].to).toEqual(['boss@acme.test']);
  });

  it('continues with the remaining tenants when one tenant fails', async () => {
    const tenantB = { id: 'tenant-2', name: 'Bora Fleet', contactEmail: null };
    prisma.client.tenant.findMany.mockResolvedValue([tenant, tenantB]);
    prisma.client.document.findMany
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([makeDocument({ id: 'doc-b', expiryDate: daysFromNow(-2) })]);

    const result = await service.scanAndNotify(NOW);

    expect(result.tenantsScanned).toBe(2);
    expect(result.tenantsNotified).toBe(1);
    expect(result.alertsSent).toBe(1);
  });
});
