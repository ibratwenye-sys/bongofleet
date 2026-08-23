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
}

export interface AssignmentDetail extends Assignment {
  motorcycle: { id: string; registrationNumber: string } | null;
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

/** A payment recorded while offline, waiting to be sent to the server. */
export interface QueuedPayment {
  clientId: string;
  dailyAssignmentId: string;
  driverId: string;
  amount: number;
  paymentMethod?: string;
  queuedAt: string;
}
