import { DailyCollectionPoint, PnlSummary } from '../analytics/analytics.service';

/**
 * Stage UI1 - the Operations Center's six real KPI-rail tiles (replacing
 * DashboardPage.tsx's four client-computed ones), plus the rail's honest
 * first-slot card and the alert list, computed server-side in one request.
 * See dashboard.service.ts for exactly which query produces each field.
 */
export interface OperationsCenterKpis {
  onTheRoad: { count: number; fleetSize: number; deltaVsYesterday: number };
  collectedToday: { amount: string; targetAmount: string; percentOfTarget: number };
  outstandingToday: { count: number; amount: string };
  activeOwnershipPlans: { count: number };
  serviceDue: { count: number; overdueCount: number };
  netProfitToday: { amount: string };
}

/**
 * Stage UI1 - the rail's first slot. A worst-performer-by-profit ranking
 * for TODAY, reusing AnalyticsService.getPerMotorcycle exactly as it
 * already computes it - never an invented pattern-detection insight. Null
 * when nothing has moved money today at all (no revenue AND no expense on
 * any vehicle) - there is no "worst" of an empty set.
 */
export interface WorstPerformerToday {
  motorcycleId: string;
  registrationNumber: string;
  vehicleType: string;
  revenue: string;
  expenses: string;
  netProfit: string;
}

export type OperationsCenterAlertSource = 'ASSIGNMENT' | 'DOCUMENT' | 'MAINTENANCE';
export type OperationsCenterAlertSeverity = 'crit' | 'warn';

export interface OperationsCenterAlert {
  source: OperationsCenterAlertSource;
  severity: OperationsCenterAlertSeverity;
  title: string;
  description: string;
  /** ISO timestamp - null for a maintenance-due row, which has no single
   *  "sent at" moment (it's a live due-status read, not a past alert). */
  when: string | null;
}

/** Stage UI1 - the full-width table's rows: today's assignments still short
 *  of their target, real (registrationNumber + amounts already computed for
 *  the outstandingToday KPI, just not thrown away this time), never a
 *  second query per row. */
export interface OutstandingAssignmentRow {
  registrationNumber: string;
  targetAmount: string;
  paidAmount: string;
  balance: string;
}

export interface OperationsCenterResponse {
  kpis: OperationsCenterKpis;
  worstPerformerToday: WorstPerformerToday | null;
  /** Stage UI1 - the closing row's "today's top performers" card: the same
   *  getPerMotorcycle ranking worstPerformerToday reads the tail of, top 3
   *  by netProfit - reused, not a second query. */
  topPerformersToday: WorstPerformerToday[];
  outstandingAssignmentRows: OutstandingAssignmentRow[];
  alerts: OperationsCenterAlert[];
  /** Last 14 days, oldest first, today last - straight from
   *  AnalyticsService.getDailyCollectionSeries. */
  collectionSeries: DailyCollectionPoint[];
  /** Today's own P&L, straight from AnalyticsService.getSummary({from:
   *  today, to: today}) - the closing "today's profit & loss" card reads
   *  this directly rather than re-deriving it from netProfitToday. */
  todaysPnl: PnlSummary;
}
