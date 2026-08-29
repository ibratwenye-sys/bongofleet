import { TransportProgress } from './transport-progress';

/** TransportService.vehicleSummary()'s own row shape - not exported by
 *  that file, so mirrored here field-for-field (same convention as
 *  dashboard.types.ts mirroring AnalyticsService's PnlSummary). */
export interface VehicleTransportSummary {
  motorcycleId: string;
  registrationNumber: string;
  vehicleType: string | null;
  jobCount: number;
  revenue: string;
  expenses: string;
  netProfit: string;
}

export interface TransportOperationsKpis {
  fleetCount: { count: number; trucks: number; cars: number };
  tripsThisMonth: { count: number; inTransitNow: number };
  revenueThisMonth: { amount: string; percentOfAllRevenue: number };
  costsThisMonth: { amount: string; percentFuel: number };
  netThisMonth: { amount: string; perVehicleAverage: string };
  marginThisMonth: { percent: number; vsMotorbikeMarginPercent: number | null };
}

export interface InTransitJob {
  reference: string | null;
  origin: string;
  destination: string;
  registrationNumber: string;
  driverName: string | null;
  cargo: string | null;
  progress: TransportProgress;
}

export interface MarginDeclineFlag {
  motorcycleId: string;
  registrationNumber: string;
  currentMarginPercent: number;
  priorAverageMarginPercent: number;
  priorMonthCount: number;
}

export type TransportAlertSource = 'ASSIGNMENT' | 'MAINTENANCE';

export interface TransportAlert {
  source: TransportAlertSource;
  severity: 'crit' | 'warn';
  title: string;
  description: string;
}

/** The closing row's "trips this month" table - straight from the
 *  existing GET /transport-jobs list (TransportService.listJobs), just the
 *  fields that table shows, never a second per-job P&L computation. */
export interface TransportTripRow {
  id: string;
  reference: string | null;
  origin: string;
  destination: string;
  registrationNumber: string;
  cargo: string | null;
  revenue: string;
  expensesTotal: string;
  netProfit: string;
  status: string;
}

export interface MarginSplit {
  fuel: string;
  other: string;
  profit: string;
  fuelPercent: number;
  otherPercent: number;
  profitPercent: number;
}

export interface TransportOperationsResponse {
  kpis: TransportOperationsKpis;
  /** Reused exactly from TransportService.vehicleSummary(), never
   *  recomputed - see this stage's build brief §6. */
  perVehicleThisMonth: VehicleTransportSummary[];
  inTransitJob: InTransitJob | null;
  /** Rail's AI Insight - a real margin-decline flag, only when at least
   *  one vehicle has 2+ prior months of history to compare against. Null
   *  when nothing qualifies - the caller falls back to `alerts` instead of
   *  forcing this slot. */
  marginDeclineFlag: MarginDeclineFlag | null;
  alerts: TransportAlert[];
  tripsThisMonth: TransportTripRow[];
  /** The flagged vehicle's own margin trend, reusing marginDeclineFlag's
   *  own computation - null when marginDeclineFlag didn't fire. */
  flaggedVehicleMarginTrend: { month: string; marginPercent: number | null }[] | null;
  marginSplit: MarginSplit;
}
