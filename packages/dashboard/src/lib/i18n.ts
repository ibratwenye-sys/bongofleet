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
import enReports from '../locales/en/reports.json';
import swReports from '../locales/sw/reports.json';
import enMotorcycleDetail from '../locales/en/motorcycleDetail.json';
import swMotorcycleDetail from '../locales/sw/motorcycleDetail.json';
import enGpsProviderSettings from '../locales/en/gpsProviderSettings.json';
import swGpsProviderSettings from '../locales/sw/gpsProviderSettings.json';
import enBilling from '../locales/en/billing.json';
import swBilling from '../locales/sw/billing.json';
import enBulkImport from '../locales/en/bulkImport.json';
import swBulkImport from '../locales/sw/bulkImport.json';
import enTrackingLinks from '../locales/en/trackingLinks.json';
import swTrackingLinks from '../locales/sw/trackingLinks.json';
import enTrackingMap from '../locales/en/trackingMap.json';
import swTrackingMap from '../locales/sw/trackingMap.json';
import type { Language } from './types';

/**
 * Stage L1 (DESIGN_SWAHILI_UI.md) - dashboard localization infrastructure.
 * No browser-language-detector plugin: `lng: 'en'` is a fixed default, not
 * a guess from the browser, matching ThemeToggle's own "never guess from
 * OS preference" precedent. auth-context.tsx calls changeLanguage() once
 * the signed-in user's own account preference is known.
 *
 * `common` (shared chassis/chrome strings) plus one namespace per page
 * batch as Stage L2-L18 translate them (operationsCenter, payments,
 * expenses, transport, fleet, maintenance, assignments, drivers,
 * approvals, reports, motorcycleDetail, gpsProviderSettings, billing,
 * bulkImport, trackingLinks, then trackingMap - see
 * DESIGN_SWAHILI_UI.md's per-page rollout plan). Not built ahead of
 * need: a page gets its own namespace only once it's actually
 * translated.
 * `gpsProviderSettings` (L14), `billing` (L15), and `bulkImport` (L16)
 * each carry their own `ownerOnlyGate` key - the plain-owner variant of
 * a five-page pattern. `trackingLinks` (L17) and `trackingMap` (L18)
 * both use `ownerOrManagerGate` instead - a genuinely different English
 * sentence shape ("owner OR a manager") - with matching grammar
 * (verb stays singular: "mmiliki"/"meneja" are the same Swahili noun
 * class). This closes out the five-page pattern.
 * `drivers` grew across two stages, same shape `transport` did at L5/L6:
 * L10 batch a covered only DriversPage's scoreboard/list body; batch b
 * finishes it with DriverFormModal, ResetPasswordModal, and everything
 * DriverDetailPage.tsx reaches (including its embedded GuarantorFormModal
 * and GuarantorRow, and PasswordRecoveryNote).
 * `documentSlot` is its own namespace, split out at L10 batch b, because
 * DocumentSlot.tsx is a genuinely shared component - the payoff of that
 * split lands at L13: MotorcycleDetailPage inherits DocumentSlot's fully-
 * translated internal strings for free, only needing its own small
 * `motorcycleDetail` namespace for the caller-supplied labels/hint it
 * passes in. ApprovalsPage similarly uses its own sibling namespace
 * `approvals` for its page-specific strings as of L11.
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
      reports: enReports,
      motorcycleDetail: enMotorcycleDetail,
      gpsProviderSettings: enGpsProviderSettings,
      billing: enBilling,
      bulkImport: enBulkImport,
      trackingLinks: enTrackingLinks,
      trackingMap: enTrackingMap,
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
      reports: swReports,
      motorcycleDetail: swMotorcycleDetail,
      gpsProviderSettings: swGpsProviderSettings,
      billing: swBilling,
      bulkImport: swBulkImport,
      trackingLinks: swTrackingLinks,
      trackingMap: swTrackingMap,
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
