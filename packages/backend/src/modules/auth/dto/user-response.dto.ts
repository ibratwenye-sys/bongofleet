import { DriverType, TenantStatus, Theme, UserRole } from '@prisma/client';

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
  // Stage DM1 - null for anyone without a Driver row (OWNER/MANAGER/
  // MECHANIC); the driver app reads this to decide rider vs car/truck-driver
  // UI. See AuthService.getDriverType for why this is a separate lookup
  // rather than something validateToken already carries.
  driverType: DriverType | null;
  // Stage UI1 - null means "never chosen"; the dashboard falls back to dark
  // (see the Theme enum's own schema comment), never guessing from OS
  // preference.
  theme: Theme | null;

  static fromProfile(profile: {
    userId: string;
    tenantId: string;
    email: string;
    role: UserRole;
    firstName: string;
    lastName: string;
    tenantStatus: TenantStatus;
    trialEndsAt: Date | null;
    driverType: DriverType | null;
    theme: Theme | null;
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
    dto.driverType = profile.driverType;
    dto.theme = profile.theme;
    return dto;
  }
}
