export interface MaintenanceSummaryKpis {
  overdue: { count: number };
  dueWithin7Days: { count: number };
  dueWithin30Days: { count: number };
  nothingDue: { count: number; percentOfFleet: number };
  completedThisMonth: { count: number; cost: string };
  /** Stage UI2 (§7) - a vehicle with 2+ MaintenanceLog entries within a
   *  rolling 45-day window. Documented as a heuristic: there is no
   *  system-level concept of a "recurring fault" to key off instead. */
  repeatVisits: { count: number };
}

export interface NeedsBookingRow {
  motorcycleId: string;
  registrationNumber: string;
  vehicleType: string;
  currentDriver: string | null;
  reasons: string[];
  odometer: number;
  nextServiceDate: string | null;
  nextServiceMileage: number | null;
  status: 'OVERDUE' | 'DUE_SOON';
}

export interface ServicePipelineBucket {
  bucket: 'OVERDUE' | 'DUE_7' | 'DUE_30' | 'NOTHING_DUE';
  count: number;
  share: number;
}

export interface RepeatVisitVehicle {
  motorcycleId: string;
  registrationNumber: string;
  visitCount: number;
  totalSpend: string;
}

export type MaintenanceAlertSource = 'MAINTENANCE';

export interface MaintenanceInsight {
  title: string;
  description: string;
  motorcycleId: string | null;
}

export interface CompletedServiceRow {
  id: string;
  motorcycleId: string;
  registrationNumber: string;
  description: string;
  performedAt: string;
  mileageAtService: number | null;
  nextServiceDate: string | null;
  nextServiceMileage: number | null;
  cost: string;
}

export interface MaintenanceSummaryResponse {
  kpis: MaintenanceSummaryKpis;
  needsBooking: NeedsBookingRow[];
  servicePipeline: ServicePipelineBucket[];
  /** Rail's AI Insights slot - up to two real insights (repeat-failure
   *  flag, "due soon" flag), never padded to two when only one is real. */
  insights: MaintenanceInsight[];
  atRisk: NeedsBookingRow[];
  completedThisMonth: CompletedServiceRow[];
  spendByVehicleType: { vehicleType: string; amount: string }[];
  repeatVisitVehicles: RepeatVisitVehicle[];
}
