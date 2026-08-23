// Shapes mirror the backend responses (Prisma Decimals serialize as strings).

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type DriverType = 'RIDER' | 'CAR_DRIVER' | 'TRUCK_DRIVER';

export interface Me {
  id: string;
  email: string;
  role: 'OWNER' | 'MANAGER' | 'RIDER' | 'MECHANIC';
  firstName: string;
  lastName: string;
  /** Null for anyone without a Driver row (OWNER/MANAGER/MECHANIC). */
  driverType: DriverType | null;
}

export interface Assignment {
  id: string;
  driverId: string;
  motorcycleId: string;
  assignedDate: string;
  targetAmount: string;
  notes: string | null;
  /** Permanent, never-repeating ride number (e.g. BF-7K3M9QP2). */
  reference: string | null;
  /** Null for a plain daily-rental assignment - set when the vehicle is on
   *  an ownership plan (Stage D's vehicle-lock rule). Mkataba wangu reads
   *  this off the rider's own assignments to find their plan id; there is
   *  no dedicated "my plan" endpoint. */
  ownershipPlanId: string | null;
}

export type MotorcycleStatus = 'ACTIVE' | 'MAINTENANCE' | 'RETIRED';

/** The bike-identifying fields Pikipiki shows - only ever reached via
 *  GET /assignments/:id, never added to the list endpoint's shape. */
export interface Motorcycle {
  id: string;
  registrationNumber: string;
  vehicleType: string;
  make: string | null;
  model: string | null;
  year: number | null;
  chassisNumber: string | null;
  colour: string | null;
  status: MotorcycleStatus;
  currentMileage: number;
}

export interface AssignmentDetail extends Assignment {
  motorcycle: Motorcycle | null;
}

export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface Payment {
  id: string;
  dailyAssignmentId: string;
  driverId: string;
  amount: string;
  status: PaymentStatus;
  paymentMethod: string | null;
  paidAt: string | null;
  createdAt: string;
  receiptFileName: string | null;
  receiptUploadedAt: string | null;
}

export type OwnershipPlanStatus = 'ACTIVE' | 'COMPLETED' | 'DEFAULTED' | 'CANCELLED';

/** GET /ownership-plans/:id - 404s (not 403) for a RIDER who isn't the
 *  driver on this plan, same as an unknown id (OwnershipPlanService.
 *  assertCanView), so this shape is only ever seen for the caller's own
 *  plan. */
export interface OwnershipPlan {
  id: string;
  dailyAmount: string;
  instalmentCount: number;
  totalPrice: string;
  downPayment: string;
  startDate: string;
  contractEndDate: string | null;
  status: OwnershipPlanStatus;
  completedAt: string | null;
  defaultedAt: string | null;
  amountDue: string;
  amountPaid: string;
  amountBilled: string;
  netPosition: string;
  daysBehind: number;
  daysAhead: number;
  consecutiveMissedDays: number;
  remainingToOwn: string;
  remainingToBill: string;
  daysLeft: number;
  derivedEndDate: string;
  projectedCompletion: string;
  /** Stage G2 (driver app) - the date the driver's current credit runs out;
   *  only meaningful, and only non-null, when daysAhead > 0. */
  nextDueDate: string | null;
}

/** One row of GET /ownership-plans/:id/ledger. */
export interface OwnershipPlanLedgerEntry {
  assignedDate: string;
  owed: string;
  paid: string;
  runningPosition: string;
}

export type TransportJobStatus = 'SCHEDULED' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';

export interface TransportJobExpense {
  id: string;
  category: string;
  amount: string;
  incurredAt: string;
  description: string | null;
}

/**
 * GET /transport-jobs and GET /transport-jobs/:id (RIDER-narrowed to the
 * caller's own driverId - Stage DM4). revenue and netProfit are both
 * omitted from a RIDER's response body server-side (TransportService's
 * omitOwnerFinancials): revenue is the owner's earnings on the job, not the
 * driver's business, and netProfit (= revenue - expensesTotal) is the same
 * secret in a different shape - so neither field exists on this type.
 * expensesTotal stays visible; it's the job's operational cost record, not
 * the owner's earnings.
 */
export interface TransportJob {
  id: string;
  driverId: string | null;
  motorcycleId: string;
  ownerDriven: boolean;
  reference: string | null;
  origin: string;
  destination: string;
  cargo: string | null;
  status: TransportJobStatus;
  scheduledDate: string;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  expensesTotal: string;
  motorcycle: Motorcycle;
}

/** GET /transport-jobs/:id adds the per-job expense list on top of the list shape. */
export interface TransportJobDetail extends TransportJob {
  expenses: TransportJobExpense[];
}

/** A payment recorded while offline, waiting to be sent to the server. */
export interface QueuedPayment {
  clientId: string;
  dailyAssignmentId: string;
  driverId: string;
  amount: number;
  paymentMethod?: string;
  queuedAt: string;
}
