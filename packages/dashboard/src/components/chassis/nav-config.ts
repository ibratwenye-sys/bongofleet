import type { UserRole } from '../../lib/types';

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  roles?: UserRole[];
  /** Set for the one item (Approvals) that already has a real backend count
   *  to show - see AppShell.tsx's pendingCount poll. Never a placeholder
   *  number. */
  badgeKey?: 'approvals';
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Stage UI1 (DESIGN_UI_DIRECTIONS.md) - the sidebar's Live/Fleet/Money/Admin
 * grouping, generalized from the old flat NAV_LINKS list. Every route below
 * already exists in App.tsx - this stage does not invent a destination for
 * anything, including two items the reference mockup shows that this
 * codebase has no page for yet:
 *
 * - "Alerts" (its own nav item with a pill count in the reference) has no
 *   page here. The Operations Center's own real Alerts card is where those
 *   same alert rows actually surface this stage - see OperationsCenterPage.
 * - "Documents" has no standalone page either (documents are managed
 *   contextually per driver/vehicle via DocumentSlot, not a top-level list).
 *
 * Both are left out rather than pointed at something fake. Building either
 * as a real page is exactly the kind of "other eight sections" work this
 * stage explicitly defers.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Live',
    items: [
      { to: '/', label: 'Operations Center', end: true },
      { to: '/settings/tracking-map', label: 'Live Map', roles: ['OWNER', 'MANAGER'] },
    ],
  },
  {
    label: 'Fleet',
    items: [
      { to: '/fleet', label: 'Fleet' },
      { to: '/drivers', label: 'Drivers' },
      { to: '/assignments', label: 'Assignments' },
      { to: '/transport', label: 'Transport' },
      { to: '/maintenance', label: 'Maintenance' },
    ],
  },
  {
    label: 'Money',
    items: [
      { to: '/payments', label: 'Payments' },
      { to: '/ownership', label: 'Ownership' },
      { to: '/expenses', label: 'Expenses' },
      { to: '/approvals', label: 'Approvals', badgeKey: 'approvals' },
      { to: '/reports', label: 'Reports' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/settings/billing', label: 'Billing', roles: ['OWNER'] },
      { to: '/settings/gps-provider', label: 'GPS Provider', roles: ['OWNER'] },
      { to: '/settings/tracking-links', label: 'Links', roles: ['OWNER', 'MANAGER'] },
      { to: '/settings/bulk-import', label: 'Import', roles: ['OWNER'] },
    ],
  },
];
