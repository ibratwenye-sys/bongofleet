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
  notes: string | null;
}

export interface CreateAssignmentPayload {
  motorcycleId: string;
  riderId: string;
  assignedDate: string;
  targetAmount: number;
  notes?: string;
}

export interface CreatePaymentPayload {
  dailyAssignmentId: string;
  riderId: string;
  amount: number;
  paymentMethod?: string;
}

export interface UpdatePaymentPayload {
  status: PaymentStatus;
  paymentMethod?: string;
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
  currentMileage: number;
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

export type DocumentOwnerType = 'RIDER' | 'MOTORCYCLE' | 'GUARANTOR';

export type DocType =
  | 'NATIONAL_ID'
  | 'DRIVERS_LICENSE'
  | 'LATRA'
  | 'INSURANCE'
  | 'REGISTRATION_CARD'
  | 'VEHICLE_INSPECTION'
  | 'ROAD_SAFETY_WEEK'
  | 'TBS_CERTIFICATE'
  | 'GUARANTOR_ID'
  | 'OTHER';

export type DocumentExpiryStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';

// The raw shape returned by POST/GET /documents - deliberately has no
// `status` field (see document.service.ts's list()); only GET
// /documents/expiring computes one (see ExpiringDocument below).
export interface Document {
  id: string;
  ownerType: DocumentOwnerType;
  ownerId: string;
  docType: DocType;
  referenceNumber: string | null;
  expiryDate: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface ExpiringDocument extends Document {
  status: DocumentExpiryStatus;
  ownerLabel: string;
}

export interface Guarantor {
  id: string;
  riderId: string;
  firstName: string;
  lastName: string;
  phone: string;
  relationship: string | null;
  nationalId: string | null;
  isActive: boolean;
}

export interface CreateGuarantorPayload {
  firstName: string;
  lastName: string;
  phone: string;
  relationship?: string;
  nationalId?: string;
}

export interface UpdateGuarantorPayload {
  firstName?: string;
  lastName?: string;
  phone?: string;
  relationship?: string;
  nationalId?: string;
}

// --- Expenses & analytics (money fields are Prisma Decimals -> strings) ---

export interface Expense {
  id: string;
  motorcycleId: string | null;
  category: string;
  amount: string;
  incurredAt: string;
  description: string | null;
  createdAt: string;
}

export interface CreateExpensePayload {
  category: string;
  amount: number;
  incurredAt: string;
  motorcycleId?: string;
  description?: string;
}

export interface UpdateExpensePayload {
  category?: string;
  amount?: number;
  incurredAt?: string;
  motorcycleId?: string;
  description?: string;
}

export interface PnlSummary {
  from: string | null;
  to: string | null;
  revenue: string;
  expenses: string;
  netProfit: string;
  paymentCount: number;
  expenseCount: number;
}

export interface MotorcyclePnl {
  motorcycleId: string;
  registrationNumber: string;
  revenue: string;
  expenses: string;
  netProfit: string;
}

export interface RiderRevenue {
  riderId: string;
  riderName: string;
  revenue: string;
  paymentCount: number;
}

export interface ExpenseCategory {
  category: string;
  amount: string;
  count: number;
}

// --- Maintenance (money fields are Prisma Decimals -> strings) ---

export interface MaintenanceLog {
  id: string;
  motorcycleId: string;
  mechanicId: string | null;
  description: string;
  cost: string;
  performedAt: string;
  mileageAtService: number | null;
  nextServiceDate: string | null;
  nextServiceMileage: number | null;
  createdAt: string;
}

export interface CreateMaintenancePayload {
  motorcycleId: string;
  description: string;
  cost: number;
  performedAt: string;
  mechanicId?: string;
  mileageAtService?: number;
  nextServiceDate?: string;
  nextServiceMileage?: number;
}

export interface UpdateMaintenancePayload {
  description?: string;
  cost?: number;
  performedAt?: string;
  mechanicId?: string;
  mileageAtService?: number;
  nextServiceDate?: string;
  nextServiceMileage?: number;
}
