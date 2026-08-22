import { TenantStatus, UserRole } from '@prisma/client';

export class UserResponseDto {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  // Stage S1 - /auth/me is reachable even while locked (@AllowWhenLocked),
  // specifically so a client can read this and know what screen to show
  // (verify-your-email, trial-ended, ...) instead of just seeing every other
  // request fail with no way to explain why.
  tenantStatus: TenantStatus;
  trialEndsAt: Date | null;

  static fromProfile(profile: {
    userId: string;
    tenantId: string;
    email: string;
    role: UserRole;
    firstName: string;
    lastName: string;
    tenantStatus: TenantStatus;
    trialEndsAt: Date | null;
  }): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = profile.userId;
    dto.tenantId = profile.tenantId;
    dto.email = profile.email;
    dto.role = profile.role;
    dto.firstName = profile.firstName;
    dto.lastName = profile.lastName;
    dto.tenantStatus = profile.tenantStatus;
    dto.trialEndsAt = profile.trialEndsAt;
    return dto;
  }
}
