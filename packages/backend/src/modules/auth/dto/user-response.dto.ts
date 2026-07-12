import { UserRole } from '@prisma/client';

export class UserResponseDto {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;

  static fromProfile(profile: {
    userId: string;
    tenantId: string;
    email: string;
    role: UserRole;
    firstName: string;
    lastName: string;
  }): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = profile.userId;
    dto.tenantId = profile.tenantId;
    dto.email = profile.email;
    dto.role = profile.role;
    dto.firstName = profile.firstName;
    dto.lastName = profile.lastName;
    return dto;
  }
}
