// Local types matching the live backend response shapes. Deliberately not sourced
// from @bongofleet/shared-lib - its UserRole enum (FLEET_OWNER/DISPATCHER/RIDER)
// doesn't match the real Prisma enum (OWNER/MANAGER/RIDER/MECHANIC).
export type UserRole = 'OWNER' | 'MANAGER' | 'RIDER' | 'MECHANIC';

// Stage UI1 - null means "never chosen"; the dashboard falls back to dark
// (DESIGN_THEMING.md's deliberate default), never guessing from OS
// preference. Lives on the account (auth-context.tsx), not browser storage,
// so it reads the same on every device.
export type Theme = 'DARK' | 'LIGHT';

export interface CurrentUser {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  theme: Theme | null;
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
  // Stage G6 Part 2 - non-null when the nightly hire-purchase generator
  // created this assignment; distinguishes a rent-to-own charge from an
  // ordinary daily-rental one. Was already on the API response, just not
  // declared here until the rent-to-own payment flow needed to filter on it.
  ownershipPlanId: string | null;
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
  /** Stage H0f Part 2 - when this address was last proven to reach him, by his
   *  completing a password reset with a code sent to it. Null means it never
   *  has been, which is the normal state for a rider whose address was typed
   *  by his owner to get past a required field. */
  emailProvenAt: string | null;
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

// Stage G6 Part 2 - the searchable driver picker's result shape, distinct
// from the full Driver type: only what's needed to disambiguate one driver
// from another (name, phone, current vehicle plate) plus the id to submit.
export interface DriverSearchResult {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  registrationNumber: string | null;
  isActive: boolean;
}

export interface DriverSearchResponse {
  results: DriverSearchResult[];
  hasMore: boolean;
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

export type ExpenseStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Expense {
  id: string;
  motorcycleId: string | null;
  category: string;
  amount: string;
  incurredAt: string;
  description: string | null;
  createdAt: string;
  // Stage H1/H2 - the approval trail. status defaults APPROVED for every
  // dashboard-created row (the OWNER/MANAGER creating it IS the approver);
  // only a rider submission (H2) is ever PENDING. submittedByUserId/
  // submittedByRiderId/dailyAssignmentId are null on a dashboard-created
  // row, set on a rider submission.
  status: ExpenseStatus;
  submittedByUserId: string | null;
  submittedByRiderId: string | null;
  dailyAssignmentId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  receiptStorageKey: string | null;
  receiptFileName: string | null;
  receiptMimeType: string | null;
  receiptSizeBytes: number | null;
  receiptUploadedAt: string | null;
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

// --- Tenant billing (Stage SUB1, DESIGN_SUBSCRIPTION.md §5b) ---
// pricePerBikePerMonth/estimatedMonthlyTotal are Prisma Decimals -> strings,
// same convention as the rest of this file.

export type TenantStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

export interface TenantBilling {
  activeBikeCount: number;
  pricePerBikePerMonth: string;
  estimatedMonthlyTotal: string;
  status: TenantStatus;
  trialEndsAt: string | null;
  billingExempt: boolean;
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
  // Stage G7 - the agreed number of payment days. totalOwed = dailyAmount *
  // instalmentCount, exactly - never derived from totalPrice/downPayment.
  instalmentCount: number;
  // Declared value of the vehicle and the deposit taken - printed on the
  // contract only; independent of instalmentCount/totalOwed.
  totalPrice: string;
  downPayment: string;
  // Stage G10 (§9e) - how the down payment above is treated. Irrelevant when
  // downPayment is "0.00". registrationCard/spareKey/nameTransfer have no
  // gating; depositReturned is settable only when this is HELD_REFUNDABLE -
  // see CompletionChecklistSection on the detail page.
  depositHandling: 'APPLIED' | 'HELD_REFUNDABLE';
  registrationCardHandedOverAt: string | null;
  spareKeyHandedOverAt: string | null;
  nameTransferConfirmedAt: string | null;
  depositReturnedAt: string | null;
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
  // Stage G5 Part 3 - APPROVED excusals in the last 90 days. A signal, not a
  // limit - there is no cap this feeds into.
  recentExcusalCount: number;
  // Stage H1 - instalmentCount is authoritative (totalOwed = dailyAmount x
  // instalmentCount, always), so the end date - and therefore daysLeft - is
  // always derivable even when contractEndDate was never typed in. Never
  // null now; see derivedEndDate below and ownership-plan.derivation.ts.
  daysLeft: number;
  // The date the plan's OWN terms (instalmentCount days from startDate, over
  // activeWeekdays) project as the end date - always populated, independent
  // of contractEndDate. When contractEndDate is set, the two may legitimately
  // differ (a renegotiated term) - show both, never silently pick one.
  derivedEndDate: string;
  projectedCompletion: string;
  // Stage G10 - a THIRD, separate signal from daysBehind/consecutiveMissedDays
  // (a date condition, not a payment-streak condition) - render it as its
  // own indicator, never folded into the behind/ahead column or breach flag.
  pastDeadlineStillOwing: boolean;
}

export interface CreateOwnershipPlanPayload {
  driverId: string;
  motorcycleId: string;
  guarantorId?: string;
  dailyAmount: number;
  // Stage G7 - the agreed number of payment days. totalOwed = dailyAmount *
  // instalmentCount, exactly - see estimatePlanTerm (shared-lib).
  instalmentCount: number;
  // Declared value of the vehicle and the deposit taken - independent of
  // instalmentCount/totalOwed; never used in the create-plan form's math.
  totalPrice: number;
  downPayment?: number;
  // Stage G10 (§9e) - defaults to APPLIED server-side when omitted. The form
  // only offers the choice once a down payment is actually entered.
  depositHandling?: 'APPLIED' | 'HELD_REFUNDABLE';
  startDate: string;
  contractEndDate?: string;
  activeWeekdays?: number[];
  graceDays?: number;
  lateFeeAmount?: number;
  breachAfterConsecutiveMissedDays?: number;
  notes?: string;
}

// Stage G6 Part 4 - contractEndDate was the one field the dashboard edited
// on an existing plan; Stage G10 adds the completion-checklist toggles
// (each true stamps the matching *At to now, false clears it - see
// CompletionChecklistSection). UpdateOwnershipPlanDto supports more, but
// nothing else has a dashboard editor yet - not adding payload shape for UI
// that doesn't exist.
export interface UpdateOwnershipPlanPayload {
  contractEndDate?: string;
  registrationCardHandedOver?: boolean;
  spareKeyHandedOver?: boolean;
  nameTransferConfirmed?: boolean;
  depositReturned?: boolean;
}

export interface OwnershipPlanLedgerRow {
  assignedDate: string;
  owed: string;
  paid: string;
  runningPosition: string;
}

// Stage G5 - matches DayExcusal (backend Prisma model) plus the
// decidedByName/requestedByName the excusal service enriches list() with
// (both plain scalars server-side, no relation to join through on the
// client). REQUESTED has no creation path yet (the driver-app request path
// is a later stage) but the type exists now so the ledger doesn't need
// rewriting when it does.
export type DayExcusalStatus = 'REQUESTED' | 'APPROVED' | 'DECLINED';

export interface DayExcusal {
  id: string;
  ownershipPlanId: string;
  excusedDate: string;
  reason: string;
  status: DayExcusalStatus;
  requestedByUserId: string | null;
  requestedByName: string | null;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface CreateDayExcusalPayload {
  excusedDate: string;
  reason: string;
}

// --- Tracking links (Stage I2, DESIGN_GPS_TRACKING.md §8) ---

export type TrackingLinkStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface TrackingLink {
  id: string;
  motorcycleId: string | null;
  token: string;
  label: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdByUserId: string;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
  status: TrackingLinkStatus;
}

export interface CreateTrackingLinkPayload {
  motorcycleId?: string;
  label: string;
  /** Omitted -> backend defaults to 7 days out. Explicit null -> never expires. */
  expiresAt?: string | null;
}

// --- Public tracking view (Stage I2 §8) - the exact whitelist GET
// /public/track/:token returns, no auth, no tenant/rider data of any kind.
// Mirrors PublicVehiclePosition on the backend (tracking-link-public.
// service.ts) field for field.

export type PublicVehiclePosition =
  | {
      registrationNumber: string;
      offline: false;
      latitude: number;
      longitude: number;
      recordedAt: string;
      source: 'PHONE' | 'DEVICE' | 'MANUAL';
    }
  | {
      registrationNumber: string;
      offline: true;
      lastKnownAt: string | null;
    };

// --- Live fleet map (Stage I3, DESIGN_GPS_TRACKING.md §7) ---
// Mirrors GpsService's FleetVehiclePosition/VehiclePathPoint (backend
// gps.service.ts) field for field. Authenticated/internal, unlike
// PublicVehiclePosition above - carries motorcycleId/vehicleType too, for
// the map to key markers and filter by category client-side.

export type FleetVehiclePosition = {
  motorcycleId: string;
  registrationNumber: string;
  vehicleType: VehicleType;
} & (
  | {
      offline: false;
      latitude: number;
      longitude: number;
      recordedAt: string;
      source: 'PHONE' | 'DEVICE' | 'MANUAL';
    }
  | { offline: true; lastRecordedAt: string | null }
);

export interface VehiclePathPoint {
  recordedAt: string;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
}

// Stage BI1 - bulk import from Excel (Settings area, OWNER-only).
export type BulkImportSheet = 'vehicles' | 'drivers' | 'assignments' | 'ownershipPlans';

export type BulkImportRowStatus = 'new' | 'update' | 'reference' | 'error';

export interface BulkImportRowMessage {
  text: string;
  severity: 'error' | 'warning';
}

export interface BulkImportRowResult {
  row: number;
  status: BulkImportRowStatus;
  values: Record<string, string | number | null>;
  messages: BulkImportRowMessage[];
}

export interface BulkImportSheetResult {
  sheet: BulkImportSheet;
  rows: BulkImportRowResult[];
}

export interface BulkImportPreviewResult {
  sheets: BulkImportSheetResult[];
  canCommit: boolean;
}

export interface BulkImportCommitCounts {
  vehiclesCreated: number;
  vehiclesUpdated: number;
  driversCreated: number;
  driversUpdated: number;
  ownershipPlansCreated: number;
  ownershipPlansUpdated: number;
}

export interface BulkImportCommitResult {
  preview: BulkImportPreviewResult;
  counts: BulkImportCommitCounts;
}

// Stage UI1 - the Operations Center's single data source (GET
// /dashboard/operations-center). Mirrors dashboard.types.ts on the backend.
export interface OperationsCenterKpis {
  onTheRoad: { count: number; fleetSize: number; deltaVsYesterday: number };
  collectedToday: { amount: string; targetAmount: string; percentOfTarget: number };
  outstandingToday: { count: number; amount: string };
  activeOwnershipPlans: { count: number };
  serviceDue: { count: number; overdueCount: number };
  netProfitToday: { amount: string };
}

export interface MotorcyclePnl {
  motorcycleId: string;
  registrationNumber: string;
  vehicleType: VehicleType;
  revenue: string;
  expenses: string;
  netProfit: string;
}

export interface OutstandingAssignmentRow {
  registrationNumber: string;
  targetAmount: string;
  paidAmount: string;
  balance: string;
}

export type OperationsCenterAlertSource = 'ASSIGNMENT' | 'DOCUMENT' | 'MAINTENANCE';
export type OperationsCenterAlertSeverity = 'crit' | 'warn';

export interface OperationsCenterAlert {
  source: OperationsCenterAlertSource;
  severity: OperationsCenterAlertSeverity;
  title: string;
  description: string;
  when: string | null;
}

export interface DailyCollectionPoint {
  date: string;
  amount: string;
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

export interface OperationsCenterResponse {
  kpis: OperationsCenterKpis;
  worstPerformerToday: MotorcyclePnl | null;
  topPerformersToday: MotorcyclePnl[];
  outstandingAssignmentRows: OutstandingAssignmentRow[];
  alerts: OperationsCenterAlert[];
  collectionSeries: DailyCollectionPoint[];
  todaysPnl: PnlSummary;
}
