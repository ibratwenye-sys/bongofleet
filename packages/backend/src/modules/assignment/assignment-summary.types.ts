import { IdleVehicleRow } from '../../common/idle-vehicles.util';

export interface AssignmentSummaryKpis {
  assignedToday: { count: number; fleetSize: number; percentOfFleet: number };
  movingToday: { count: number; percentActuallyEarning: number };
  assignedInWorkshopToday: { count: number };
  inStockToday: { count: number; targetLost: string };
  createdThisMonth: { count: number; percentEndedWithPayment: number };
  costOfIdlenessThisMonth: { amount: string };
}

export interface DailyStockPoint {
  date: string;
  outCount: number;
  inStockCount: number;
}

export interface AssignmentInsight {
  title: string;
  description: string;
  motorcycleId: string | null;
}

export interface AssignmentSummaryResponse {
  kpis: AssignmentSummaryKpis;
  dailyStockSeries: DailyStockPoint[];
  utilisationToday: { moving: number; workshop: number; inStock: number };
  /** Rail's AI Insights slot - up to two real, computed insights (see
   *  assignment-summary.service.ts's own comment); never padded to two
   *  when only one is real. */
  insights: AssignmentInsight[];
  unassignedNow: IdleVehicleRow[];
  thisMonth: {
    created: number;
    endedWithPayment: number;
    endedWithNothing: number;
    valueOfUnpaidDays: string;
  };
  idlenessCostByType: {
    vehicleType: string;
    count: number;
    amount: string;
    /** The single vehicle contributing the most to this type's idleness
     *  cost, real and derived - null when the type has no idle vehicles. */
    topContributor: string | null;
  }[];
}
