import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { DocumentOwnerType } from '@prisma/client';

export class ListDocumentsQueryDto {
  @IsEnum(DocumentOwnerType)
  ownerType: DocumentOwnerType;

  @IsString()
  @IsNotEmpty()
  ownerId: string;
}
