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

export type MotorcycleStatus = 'ACTIVE' | 'MAINTENANCE' | 'RETIRED';

export interface Motorcycle {
  id: string;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  year: number | null;
  gpsDeviceId: string | null;
  status: MotorcycleStatus;
  isActive: boolean;
}

export interface CreateMotorcyclePayload {
  registrationNumber: string;
  make?: string;
  model?: string;
  year?: number;
  gpsDeviceId?: string;
}

export interface UpdateMotorcyclePayload {
  registrationNumber?: string;
  make?: string;
  model?: string;
  year?: number;
  gpsDeviceId?: string;
  status?: MotorcycleStatus;
}

// A rider's name/email/phone live on the linked User, not flat on the Rider record
// (see rider.service.ts's SAFE_USER_SELECT) - passwordHash is never included.
export interface RiderUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  isActive: boolean;
}

export interface Rider {
  id: string;
  licenseNumber: string;
  nationalId: string | null;
  emergencyContact: string | null;
  isActive: boolean;
  user: RiderUser;
}

export interface CreateRiderPayload {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  licenseNumber: string;
  initialPassword: string;
  nationalId?: string;
  emergencyContact?: string;
}

// No email/initialPassword - UpdateRiderDto deliberately doesn't allow changing
// either (see rider.service.ts).
export interface UpdateRiderPayload {
  firstName?: string;
  lastName?: string;
  phone?: string;
  licenseNumber?: string;
  nationalId?: string;
  emergencyContact?: string;
}
