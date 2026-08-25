import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { TrackingLinkService, computeLinkStatus } from './tracking-link.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

function p2002(target: string) {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: '7.9.0',
    meta: { target: [target] },
  });
}

describe('TrackingLinkService (Stage I2, DESIGN_GPS_TRACKING.md §8)', () => {
  let service: TrackingLinkService;
  let prisma: {
    client: {
      motorcycle: { findUnique: jest.Mock };
      trackingLink: {
        create: jest.Mock;
        findMany: jest.Mock;
        findUnique: jest.Mock;
        update: jest.Mock;
      };
    };
  };

  const owner: AuthenticatedUser = {
    userId: 'user-owner',
    tenantId: 'tenant-1',
    role: UserRole.OWNER,
    email: 'owner@example.com',
    firstName: 'O',
    lastName: 'Wner',
    jti: 'jti-owner',
  };

  const rider: AuthenticatedUser = { ...owner, userId: 'user-rider', role: UserRole.RIDER };

  const baseRow = {
    id: 'link-1',
    tenantId: 'tenant-1',
    motorcycleId: null,
    token: 'sometoken',
    label: 'Whole fleet',
    expiresAt: null,
    revokedAt: null,
    createdByUserId: 'user-owner',
    viewCount: 0,
    lastViewedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    prisma = {
      client: {
        motorcycle: { findUnique: jest.fn() },
        trackingLink: {
          create: jest.fn(),
          findMany: jest.fn(),
          findUnique: jest.fn(),
          update: jest.fn(),
        },
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [TrackingLinkService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(TrackingLinkService);
  });

  describe('role gating', () => {
    it('rejects a non-OWNER/MANAGER on create/list/revoke', async () => {
      await expect(service.create({ label: 'x' }, rider)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.list(rider)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.revoke('link-1', rider)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('create', () => {
    it('defaults expiresAt to 7 days out when omitted entirely', async () => {
      prisma.client.trackingLink.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseRow, ...data }),
      );

      const before = Date.now();
      const result = await service.create({ label: 'Whole fleet' }, owner);
      const after = Date.now();

      expect(result.expiresAt).not.toBeNull();
      const expiresAtMs = (result.expiresAt as Date).getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
    });

    it('honours an explicit expiresAt: null as "never expires", not the default', async () => {
      prisma.client.trackingLink.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseRow, ...data }),
      );

      const result = await service.create({ label: 'Whole fleet', expiresAt: null }, owner);

      expect(result.expiresAt).toBeNull();
    });

    it('uses a supplied expiresAt string as-is', async () => {
      prisma.client.trackingLink.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseRow, ...data }),
      );

      const result = await service.create(
        { label: 'Whole fleet', expiresAt: '2026-09-01T00:00:00.000Z' },
        owner,
      );

      expect(result.expiresAt).toEqual(new Date('2026-09-01T00:00:00.000Z'));
    });

    it('404s when motorcycleId is given but does not resolve to a real vehicle', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ label: 'x', motorcycleId: 'moto-missing' }, owner),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.client.trackingLink.create).not.toHaveBeenCalled();
    });

    it('retries token generation on a P2002 token collision and succeeds', async () => {
      prisma.client.trackingLink.create
        .mockRejectedValueOnce(p2002('tracking_links_token_key'))
        .mockRejectedValueOnce(p2002('tracking_links_token_key'))
        .mockImplementationOnce(({ data }) => Promise.resolve({ ...baseRow, ...data }));

      const result = await service.create({ label: 'Whole fleet' }, owner);

      expect(prisma.client.trackingLink.create).toHaveBeenCalledTimes(3);
      expect(result.status).toBe('ACTIVE');
    });

    it('gives up after 5 collisions and rethrows rather than retrying forever', async () => {
      prisma.client.trackingLink.create.mockRejectedValue(p2002('tracking_links_token_key'));

      await expect(service.create({ label: 'x' }, owner)).rejects.toThrow();
      // Initial attempt (0) + 5 retries = 6 total calls before giving up.
      expect(prisma.client.trackingLink.create).toHaveBeenCalledTimes(6);
    });

    it('does not retry a P2002 on an unrelated constraint', async () => {
      prisma.client.trackingLink.create.mockRejectedValue(p2002('some_other_key'));

      await expect(service.create({ label: 'x' }, owner)).rejects.toThrow();
      expect(prisma.client.trackingLink.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('revoke', () => {
    it('is idempotent: revoking an already-revoked link returns its existing state, not an error', async () => {
      const revokedAt = new Date('2026-08-10T00:00:00.000Z');
      prisma.client.trackingLink.findUnique.mockResolvedValue({ ...baseRow, revokedAt });

      const result = await service.revoke('link-1', owner);

      expect(result.revokedAt).toEqual(revokedAt);
      expect(result.status).toBe('REVOKED');
      expect(prisma.client.trackingLink.update).not.toHaveBeenCalled();
    });

    it('sets revokedAt on a live link', async () => {
      prisma.client.trackingLink.findUnique.mockResolvedValue(baseRow);
      prisma.client.trackingLink.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseRow, ...data }),
      );

      const result = await service.revoke('link-1', owner);

      expect(result.status).toBe('REVOKED');
      expect(prisma.client.trackingLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('404s on an unknown id', async () => {
      prisma.client.trackingLink.findUnique.mockResolvedValue(null);

      await expect(service.revoke('nope', owner)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('computeLinkStatus', () => {
  const NOW = new Date('2026-08-24T12:00:00.000Z');

  it('REVOKED takes precedence over everything else', () => {
    const future = new Date(NOW.getTime() + 60_000);
    expect(computeLinkStatus(NOW, future, NOW)).toBe('REVOKED');
  });

  it('EXPIRED when expiresAt has passed and the link was never revoked', () => {
    const past = new Date(NOW.getTime() - 1000);
    expect(computeLinkStatus(null, past, NOW)).toBe('EXPIRED');
  });

  it('a link expiring at exactly `now` reads as EXPIRED, not ACTIVE', () => {
    expect(computeLinkStatus(null, NOW, NOW)).toBe('EXPIRED');
  });

  it('ACTIVE when neither revoked nor expired', () => {
    const future = new Date(NOW.getTime() + 60_000);
    expect(computeLinkStatus(null, future, NOW)).toBe('ACTIVE');
  });

  it('ACTIVE when expiresAt is null (never expires) and never revoked', () => {
    expect(computeLinkStatus(null, null, NOW)).toBe('ACTIVE');
  });
});
