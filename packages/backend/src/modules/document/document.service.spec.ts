import { validate } from 'class-validator';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DocumentOwnerType, DocumentType, UserRole } from '@prisma/client';
import { DocumentService, computeDocumentStatus, documentFileFilter } from './document.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateDocumentDto } from './dto/create-document.dto';

describe('DocumentService', () => {
  let service: DocumentService;
  let prisma: {
    client: {
      rider: { findUnique: jest.Mock; findMany: jest.Mock };
      motorcycle: { findUnique: jest.Mock; findMany: jest.Mock };
      guarantor: { findUnique: jest.Mock; findMany: jest.Mock };
      document: {
        findUnique: jest.Mock;
        findMany: jest.Mock;
        create: jest.Mock;
        delete: jest.Mock;
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

  const riderActor: AuthenticatedUser = {
    userId: 'user-rider',
    tenantId: 'tenant-1',
    role: UserRole.RIDER,
    email: 'rider@example.com',
    firstName: 'R',
    lastName: 'Ider',
    jti: 'jti-rider',
  };

  beforeEach(async () => {
    prisma = {
      client: {
        rider: { findUnique: jest.fn(), findMany: jest.fn() },
        motorcycle: { findUnique: jest.fn(), findMany: jest.fn() },
        guarantor: { findUnique: jest.fn(), findMany: jest.fn() },
        document: {
          findUnique: jest.fn(),
          findMany: jest.fn(),
          create: jest.fn(),
          delete: jest.fn(),
        },
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('./uploads-test') } },
      ],
    }).compile();

    service = moduleRef.get(DocumentService);
  });

  describe('create', () => {
    const dto = {
      ownerType: DocumentOwnerType.RIDER,
      ownerId: 'rider-1',
      docType: DocumentType.NATIONAL_ID,
    };
    const file = {
      originalname: 'id-card.jpg',
      mimetype: 'image/jpeg',
      size: 1024,
      buffer: Buffer.from('fake-image-bytes'),
    } as Express.Multer.File;

    it('throws NotFound when the referenced rider does not exist', async () => {
      prisma.client.rider.findUnique.mockResolvedValue(null);

      await expect(service.create(file, dto, owner)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.client.document.create).not.toHaveBeenCalled();
    });

    it('throws Forbidden when called by a RIDER', async () => {
      await expect(service.create(file, dto, riderActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.client.rider.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('list / remove / listExpiring - role enforcement', () => {
    it('throws Forbidden for RIDER on list', async () => {
      await expect(
        service.list({ ownerType: DocumentOwnerType.RIDER, ownerId: 'rider-1' }, riderActor),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws Forbidden for RIDER on remove', async () => {
      await expect(service.remove('doc-1', riderActor)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws Forbidden for RIDER on listExpiring', async () => {
      await expect(service.listExpiring({}, riderActor)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});

describe('computeDocumentStatus', () => {
  const now = new Date('2026-07-13T00:00:00.000Z');

  it('classifies a past expiry date as EXPIRED', () => {
    const expiry = new Date('2026-07-01T00:00:00.000Z');
    expect(computeDocumentStatus(expiry, 30, now)).toBe('EXPIRED');
  });

  it('classifies exactly 29 days out as EXPIRING_SOON', () => {
    const expiry = new Date('2026-08-11T00:00:00.000Z'); // now + 29 days
    expect(computeDocumentStatus(expiry, 30, now)).toBe('EXPIRING_SOON');
  });

  it('classifies exactly 30 days out (the boundary) as EXPIRING_SOON', () => {
    const expiry = new Date('2026-08-12T00:00:00.000Z'); // now + 30 days
    expect(computeDocumentStatus(expiry, 30, now)).toBe('EXPIRING_SOON');
  });

  it('classifies 31 days out as VALID', () => {
    const expiry = new Date('2026-08-13T00:00:00.000Z'); // now + 31 days
    expect(computeDocumentStatus(expiry, 30, now)).toBe('VALID');
  });

  it('classifies a null expiry date as VALID', () => {
    expect(computeDocumentStatus(null, 30, now)).toBe('VALID');
  });
});

describe('documentFileFilter', () => {
  function makeFile(mimetype: string): Express.Multer.File {
    return { mimetype } as Express.Multer.File;
  }

  it('rejects a disallowed mime type with a BadRequestException', () => {
    const callback = jest.fn();
    documentFileFilter({}, makeFile('application/octet-stream'), callback);

    expect(callback).toHaveBeenCalledWith(expect.any(BadRequestException), false);
  });

  it('accepts image/jpeg', () => {
    const callback = jest.fn();
    documentFileFilter({}, makeFile('image/jpeg'), callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('accepts application/pdf', () => {
    const callback = jest.fn();
    documentFileFilter({}, makeFile('application/pdf'), callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });
});

describe('DocumentType enum - fleet document types', () => {
  it('includes the new fleet document types alongside the existing ones', () => {
    expect(DocumentType.VEHICLE_INSPECTION).toBe('VEHICLE_INSPECTION');
    expect(DocumentType.ROAD_SAFETY_WEEK).toBe('ROAD_SAFETY_WEEK');
    expect(DocumentType.TBS_CERTIFICATE).toBe('TBS_CERTIFICATE');
    expect(DocumentType.LATRA).toBe('LATRA');
  });

  it('CreateDocumentDto validation accepts a TBS_CERTIFICATE docType', async () => {
    const dto = new CreateDocumentDto();
    dto.ownerType = DocumentOwnerType.MOTORCYCLE;
    dto.ownerId = 'moto-1';
    dto.docType = DocumentType.TBS_CERTIFICATE;

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
