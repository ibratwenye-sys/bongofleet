import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en/common.json';
import sw from '../locales/sw/common.json';
import enOperationsCenter from '../locales/en/operationsCenter.json';
import swOperationsCenter from '../locales/sw/operationsCenter.json';
import enPayments from '../locales/en/payments.json';
import swPayments from '../locales/sw/payments.json';
import enExpenses from '../locales/en/expenses.json';
import swExpenses from '../locales/sw/expenses.json';
import enTransport from '../locales/en/transport.json';
import swTransport from '../locales/sw/transport.json';
import enFleet from '../locales/en/fleet.json';
import swFleet from '../locales/sw/fleet.json';
import enMaintenance from '../locales/en/maintenance.json';
import swMaintenance from '../locales/sw/maintenance.json';
import enAssignments from '../locales/en/assignments.json';
import swAssignments from '../locales/sw/assignments.json';
import enDrivers from '../locales/en/drivers.json';
import swDrivers from '../locales/sw/drivers.json';
import enDocumentSlot from '../locales/en/documentSlot.json';
import swDocumentSlot from '../locales/sw/documentSlot.json';
import enApprovals from '../locales/en/approvals.json';
import swApprovals from '../locales/sw/approvals.json';
import type { Language } from './types';

/**
 * Stage L1 (DESIGN_SWAHILI_UI.md) - dashboard localization infrastructure.
 * No browser-language-detector plugin: `lng: 'en'` is a fixed default, not
 * a guess from the browser, matching ThemeToggle's own "never guess from
 * OS preference" precedent. auth-context.tsx calls changeLanguage() once
 * the signed-in user's own account preference is known.
 *
 * `common` (shared chassis/chrome strings) plus one namespace per page
 * batch as Stage L2-L11 translate them (operationsCenter, payments,
 * expenses, transport, fleet, maintenance, assignments, drivers, then
 * approvals - see DESIGN_SWAHILI_UI.md's per-page rollout plan). Not
 * built ahead of need: a page gets its own namespace only once it's
 * actually translated.
 * `drivers` grew across two stages, same shape `transport` did at L5/L6:
 * L10 batch a covered only DriversPage's scoreboard/list body; batch b
 * finishes it with DriverFormModal, ResetPasswordModal, and everything
 * DriverDetailPage.tsx reaches (including its embedded GuarantorFormModal
 * and GuarantorRow, and PasswordRecoveryNote).
 * `documentSlot` is its own namespace, split out at L10 batch b, because
 * DocumentSlot.tsx is a genuinely shared component - also used (still in
 * English) by MotorcycleDetailPage.tsx, which now inherits a
 * fully-translated component for free once its own page is eventually
 * translated, instead of this work being redone per page. ApprovalsPage
 * itself uses DocumentSlot's sibling namespace `approvals` for its own
 * page-specific strings as of L11.
 */
void i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: en,
      operationsCenter: enOperationsCenter,
      payments: enPayments,
      expenses: enExpenses,
      transport: enTransport,
      fleet: enFleet,
      maintenance: enMaintenance,
      assignments: enAssignments,
      drivers: enDrivers,
      documentSlot: enDocumentSlot,
      approvals: enApprovals,
    },
    sw: {
      common: sw,
      operationsCenter: swOperationsCenter,
      payments: swPayments,
      expenses: swExpenses,
      transport: swTransport,
      fleet: swFleet,
      maintenance: swMaintenance,
      assignments: swAssignments,
      drivers: swDrivers,
      documentSlot: swDocumentSlot,
      approvals: swApprovals,
    },
  },
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

/**
 * Stage L1 - same `null` = "never chosen" -> English default reasoning as
 * theme.ts's applyTheme, translated into i18next's own lowercase language
 * codes (the account field is the uppercase Prisma enum).
 */
export function applyLanguage(language: Language | null): void {
  void i18n.changeLanguage(language === 'SW' ? 'sw' : 'en');
}

export default i18n;
