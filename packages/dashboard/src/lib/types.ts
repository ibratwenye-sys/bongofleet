// Local types matching the live backend response shapes. Deliberately not sourced
// from @bongofleet/shared-lib - its UserRole enum (FLEET_OWNER/DISPATCHER/RIDER)
// doesn't match the real Prisma enum (OWNER/MANAGER/RIDER/MECHANIC).
export type UserRole = 'OWNER' | 'MANAGER' | 'RIDER' | 'MECHANIC';

export interface CurrentUser {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface Payment {
  id: string;
  dailyAssignmentId: string;
  riderId: string;
  amount: string; // Prisma Decimal serializes as a string, not a number
  status: PaymentStatus;
  paymentMethod: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface Assignment {
  id: string;
  riderId: string;
  motorcycleId: string;
  assignedDate: string;
  targetAmount: string; // Prisma Decimal serializes as a string, not a number
}

export interface Motorcycle {
  id: string;
  registrationNumber: string;
  status: 'ACTIVE' | 'MAINTENANCE' | 'RETIRED';
  isActive: boolean;
}
