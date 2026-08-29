import { MotorcyclePnl } from '../analytics/analytics.service';
import { IdleVehicleRow } from '../../common/idle-vehicles.util';

export interface FleetSummaryKpis {
  totalVehicles: { count: number; byType: string };
  onRoadToday: { count: number; percentOfFleet: number };
  idleToday: { count: number; targetLost: string };
  inWorkshop: { count: number };
  collectedToday: { amount: string };
  netPerVehicleThisMonth: { amount: string };
}

export type FleetAlertSource = 'ASSIGNMENT' | 'DOCUMENT' | 'MAINTENANCE';

export interface FleetAlert {
  source: FleetAlertSource;
  severity: 'crit' | 'warn';
  title: string;
  description: string;
  when: string | null;
}

export interface FleetTypeCount {
  vehicleType: string;
  count: number;
  share: number;
}

/** The Fleet page's area panel - grouped by Motorcycle.operatingArea,
 *  plainly labelled owner-set: no geofencing, no computed zones. */
export interface FleetAreaGroup {
  vehicleType: string;
  areas: { area: string; count: number }[];
  /** Vehicles of this type with no operatingArea set. */
  unset: number;
}

export interface FleetVehicleRow {
  motorcycleId: string;
  registrationNumber: string;
  vehicleType: string;
  currentDriver: string | null;
  operatingArea: string | null;
  targetThisMonth: string;
  paidThisMonth: string;
  netThisMonth: string;
  status: string;
  needsAttention: boolean;
}

export interface FleetSummaryResponse {
  kpis: FleetSummaryKpis;
  typeBreakdown: FleetTypeCount[];
  /** Rail's AI Insights slot - this month's worst-performing vehicle by
   *  net profit, ONLY when it is actually negative (never forced). */
  worstPerformerThisMonth: MotorcyclePnl | null;
  /** Shown in the AI Insights slot instead of worstPerformerThisMonth
   *  when nothing is below zero this month. */
  alerts: FleetAlert[];
  areaGroups: FleetAreaGroup[];
  vehicles: FleetVehicleRow[];
  idleVehicles: IdleVehicleRow[];
  netPerVehicleByType: { vehicleType: string; count: number; amount: string }[];
}
