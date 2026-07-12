import { UserRole } from '@prisma/client';

export interface JwtAccessPayload {
  sub: string;
  tenant_id: string;
  role: UserRole;
  jti: string;
}

export type JwtRefreshPayload = JwtAccessPayload;

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  role: UserRole;
  email: string;
  firstName: string;
  lastName: string;
  jti: string;
}
