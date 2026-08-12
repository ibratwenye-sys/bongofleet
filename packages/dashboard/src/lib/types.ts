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
  driverId: string;
  amount: string; // Prisma Decimal serializes as a string, not a number
  status: PaymentStatus;
  paymentMethod: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface Assignment {
  id: string;
  driverId: string;
  motorcycleId: string;
  assignedDate: string;
  targetAmount: string; // Prisma Decimal serializes as a string, not a number
  notes: string | null;
}

export interface CreateAssignmentPayload {
  motorcycleId: string;
  driverId: string;
  assignedDate: string;
  targetAmount: number;
  notes?: string;
}

export interface CreatePaymentPayload {
  dailyAssignmentId: string;
  driverId: string;
  amount: number;
  paymentMethod?: string;
}

export interface UpdatePaymentPayload {
  status: PaymentStatus;
  paymentMethod?: string;
}

export type MotorcycleStatus = 'ACTIVE' | 'MAINTENANCE' | 'RETIRED';

export type VehicleType = 'MOTORBIKE' | 'BAJAJI' | 'CAR' | 'TRUCK';

export interface Motorcycle {
  id: string;
  registrationNumber: string;
  vehicleType: VehicleType;
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
  vehicleType?: VehicleType;
  make?: string;
  model?: string;
  year?: number;
  gpsDeviceId?: string;
}

export interface UpdateMotorcyclePayload {
  registrationNumber?: string;
  vehicleType?: VehicleType;
  make?: string;
  model?: string;
  year?: number;
  gpsDeviceId?: string;
  status?: MotorcycleStatus;
}

// A driver's name/email/phone live on the linked User, not flat on the Driver record
// (see driver.service.ts's SAFE_USER_SELECT) - passwordHash is never included.
export interface DriverUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  isActive: boolean;
}

export type DriverType = 'RIDER' | 'CAR_DRIVER' | 'TRUCK_DRIVER';

export interface Driver {
  id: string;
  licenseNumber: string;
  driverType: DriverType;
  nationalId: string | null;
  emergencyContact: string | null;
  isActive: boolean;
  user: DriverUser;
}

export interface CreateDriverPayload {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  licenseNumber: string;
  initialPassword: string;
  nationalId?: string;
  emergencyContact?: string;
  driverType?: DriverType;
}

// No email/initialPassword - UpdateDriverDto deliberately doesn't allow changing
// either (see driver.service.ts).
export interface UpdateDriverPayload {
  firstName?: string;
  lastName?: string;
  phone?: string;
  licenseNumber?: string;
  nationalId?: string;
  emergencyContact?: string;
  driverType?: DriverType;
}

export type DocumentOwnerType = 'RIDER' | 'MOTORCYCLE' | 'GUARANTOR' | 'OWNERSHIP_PLAN';

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
  | 'HIRE_PURCHASE_CONTRACT'
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
  driverId: string;
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
  transportJobId?: string;
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
  vehicleType: VehicleType | null;
  revenue: string;
  rentalRevenue: string;
  transportRevenue: string;
  expenses: string;
  netProfit: string;
  paymentCount: number;
  transportJobCount: number;
  expenseCount: number;
}

export interface MotorcyclePnl {
  motorcycleId: string;
  registrationNumber: string;
  vehicleType: VehicleType;
  revenue: string;
  expenses: string;
  netProfit: string;
}

export interface DriverRevenue {
  driverId: string;
  driverName: string;
  revenue: string;
  paymentCount: number;
}

// --- Transport jobs (cars/trucks) ---

export type TransportJobStatus = 'SCHEDULED' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';

export interface TransportJob {
  id: string;
  motorcycleId: string;
  motorcycle: { registrationNumber: string; vehicleType: VehicleType } | null;
  driverId: string | null;
  driver: { user: { firstName: string; lastName: string } } | null;
  ownerDriven: boolean;
  reference: string | null;
  origin: string;
  destination: string;
  cargo: string | null;
  revenue: string;
  status: TransportJobStatus;
  scheduledDate: string;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  expensesTotal: string;
  netProfit: string;
}

export interface VehicleTransportSummary {
  motorcycleId: string;
  registrationNumber: string;
  vehicleType: VehicleType | null;
  jobCount: number;
  revenue: string;
  expenses: string;
  netProfit: string;
}

export interface CreateTransportJobPayload {
  motorcycleId: string;
  driverId?: string;
  ownerDriven?: boolean;
  origin: string;
  destination: string;
  cargo?: string;
  revenue: number;
  scheduledDate: string;
}

export interface UpdateTransportJobPayload {
  driverId?: string;
  ownerDriven?: boolean;
  origin?: string;
  destination?: string;
  cargo?: string;
  revenue?: number;
  scheduledDate?: string;
  status?: TransportJobStatus;
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

// --- Payment accounts (Stage G) ---

export type PaymentAccountKind = 'BANK' | 'LIPA_NUMBER' | 'MOBILE_MONEY';

export interface PaymentAccount {
  id: string;
  kind: PaymentAccountKind;
  provider: string;
  accountNumber: string;
  accountName: string | null;
  isActive: boolean;
  sortOrder: number;
}

// --- Tenant settings (Stage G Part 2) ---

export interface TenantSettings {
  name: string;
  physicalAddress: string | null;
  directorName: string | null;
}

export interface UpdateTenantSettingsPayload {
  physicalAddress?: string;
  directorName?: string;
}

// --- Hire-purchase ownership plans (Stage G Part 4) ---
// money fields are Prisma Decimals -> strings, same convention as the rest
// of this file. driver/motorcycle here are the OwnershipPlanService's own
// join shape - narrower than the Driver/Motorcycle types above (see
// ownership-plan.service.ts's driversById/motorcyclesById selects).

export type OwnershipPlanStatus = 'ACTIVE' | 'COMPLETED' | 'DEFAULTED' | 'CANCELLED';

export interface OwnershipPlanDriver {
  id: string;
  licenseNumber: string;
  driverType: DriverType;
  user: { firstName: string; lastName: string };
}

export interface OwnershipPlanMotorcycle {
  id: string;
  registrationNumber: string;
  vehicleType: VehicleType;
  make: string | null;
  model: string | null;
}

export interface OwnershipPlan {
  id: string;
  driverId: string;
  motorcycleId: string;
  guarantorId: string | null;
  dailyAmount: string;
  totalPrice: string;
  downPayment: string;
  startDate: string;
  contractEndDate: string | null;
  activeWeekdays: number[];
  graceDays: number;
  breachAfterConsecutiveMissedDays: number;
  status: OwnershipPlanStatus;
  notes: string | null;
  driver: OwnershipPlanDriver | null;
  motorcycle: OwnershipPlanMotorcycle | null;
  // Derived (ownership-plan.derivation.ts) - never re-derived on the client.
  amountPaid: string;
  remainingToOwn: string;
  daysBehind: number;
  daysAhead: number;
  consecutiveMissedDays: number;
  daysLeft: number | null;
  projectedCompletion: string;
}

export interface CreateOwnershipPlanPayload {
  driverId: string;
  motorcycleId: string;
  guarantorId?: string;
  dailyAmount: number;
  totalPrice: number;
  downPayment?: number;
  startDate: string;
  contractEndDate?: string;
  activeWeekdays?: number[];
  graceDays?: number;
  lateFeeAmount?: number;
  breachAfterConsecutiveMissedDays?: number;
  notes?: string;
}

export interface OwnershipPlanLedgerRow {
  assignedDate: string;
  owed: string;
  paid: string;
  runningPosition: string;
}
