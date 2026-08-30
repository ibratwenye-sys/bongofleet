/**
 * Stage G2 Part 1, moved here in Stage UI3 so the backend (ownership-summary
 * .service.ts's plan-health partition) and the dashboard (OwnershipPage.tsx's
 * row styling) classify a plan's position exactly the same way - one
 * definition, not two that could quietly drift apart.
 *
 * Red and amber watch different quantities, on purpose. Red compares
 * consecutiveMissedDays (an unbroken run) against the plan's own
 * breachAfterConsecutiveMissedDays - the contract's actual repossession
 * condition - independently of daysBehind's sign: a driver who is net ahead
 * overall but has just missed a breach-length run in a row must still show
 * red, not green. Amber is unchanged: daysBehind (a cumulative money
 * position) past graceDays, never a hardcoded threshold.
 */
export type PlanPositionSeverity = 'ok' | 'amber' | 'red';

export function positionSeverity(
  daysBehind: number,
  consecutiveMissedDays: number,
  graceDays: number,
  breachAfterConsecutiveMissedDays: number,
): PlanPositionSeverity {
  if (consecutiveMissedDays >= breachAfterConsecutiveMissedDays) return 'red';
  if (daysBehind > graceDays) return 'amber';
  return 'ok';
}
