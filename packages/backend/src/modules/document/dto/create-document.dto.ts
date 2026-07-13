import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { DocumentOwnerType, DocumentType } from '@prisma/client';

export class CreateDocumentDto {
  @IsEnum(DocumentOwnerType)
  ownerType: DocumentOwnerType;

  @IsString()
  @IsNotEmpty()
  ownerId: string;

  @IsEnum(DocumentType)
  docType: DocumentType;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceNumber?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}
