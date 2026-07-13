import type { MotorcycleStatus } from '../lib/types';

const STYLES: Record<MotorcycleStatus, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  MAINTENANCE: 'bg-amber-100 text-amber-800',
  RETIRED: 'bg-gray-100 text-gray-600',
};

export function StatusBadge({ status }: { status: MotorcycleStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {status}
    </span>
  );
}
