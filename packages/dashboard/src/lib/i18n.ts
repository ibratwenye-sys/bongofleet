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
import type { Language } from './types';

/**
 * Stage L1 (DESIGN_SWAHILI_UI.md) - dashboard localization infrastructure.
 * No browser-language-detector plugin: `lng: 'en'` is a fixed default, not
 * a guess from the browser, matching ThemeToggle's own "never guess from
 * OS preference" precedent. auth-context.tsx calls changeLanguage() once
 * the signed-in user's own account preference is known.
 *
 * `common` (shared chassis/chrome strings) plus one namespace per page
 * batch as Stage L2-L4 translate them (operationsCenter, payments, then
 * expenses - see DESIGN_SWAHILI_UI.md's per-page rollout plan). Not built
 * ahead of need: a page gets its own namespace only once it's actually
 * translated.
 */
void i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: en,
      operationsCenter: enOperationsCenter,
      payments: enPayments,
      expenses: enExpenses,
    },
    sw: {
      common: sw,
      operationsCenter: swOperationsCenter,
      payments: swPayments,
      expenses: swExpenses,
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
