import type { CurrentUser } from '../../lib/types';
import { NAV_GROUPS, type NavGroup } from './nav-config';

/**
 * Stage UI4a - shared between Sidebar.tsx (>= md) and the new phone-width
 * BottomTabBar/MobileSubNav/MoreSheet, so the two layouts can never drift
 * apart on which links a given role can see.
 */
export function filterVisibleGroups(user: CurrentUser | null): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.roles || (user != null && item.roles.includes(user.role)),
    ),
  })).filter((group) => group.items.length > 0);
}

/**
 * Maps each NAV_GROUPS heading to the bottom tab bar's own id/label -
 * Stage UI4a. Kept separate from nav-config.ts rather than renaming its
 * group labels there, since the >= md sidebar still renders those labels
 * directly ("Live", "Admin") and shouldn't inherit phone-specific naming
 * ("Home", "More").
 */
export type MobileTabId = 'home' | 'fleet' | 'money' | 'more';

export interface MobileTab {
  id: MobileTabId;
  label: string;
  groupLabel: string;
}

export const MOBILE_TABS: MobileTab[] = [
  { id: 'home', label: 'Home', groupLabel: 'Live' },
  { id: 'fleet', label: 'Fleet', groupLabel: 'Fleet' },
  { id: 'money', label: 'Money', groupLabel: 'Money' },
  { id: 'more', label: 'More', groupLabel: 'Admin' },
];

function isPathActive(itemTo: string, pathname: string): boolean {
  if (itemTo === '/') return pathname === '/';
  return pathname === itemTo || pathname.startsWith(`${itemTo}/`);
}

/**
 * Which NAV_GROUPS group the current route belongs to - exact match for
 * '/' (it would otherwise prefix-match every route), prefix match
 * otherwise (e.g. /fleet/123 still highlights Fleet). Falls back to the
 * Live group, the app's landing route, if nothing matches - shouldn't
 * happen given the routes App.tsx actually registers.
 */
export function getActiveGroupLabel(pathname: string): string {
  for (const group of NAV_GROUPS) {
    if (group.items.some((item) => isPathActive(item.to, pathname))) {
      return group.label;
    }
  }
  return NAV_GROUPS[0].label;
}
