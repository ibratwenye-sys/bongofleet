import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en/common.json';
import sw from '../locales/sw/common.json';
import type { Language } from './types';

/**
 * Stage L1 (DESIGN_SWAHILI_UI.md) - dashboard localization infrastructure.
 * No browser-language-detector plugin: `lng: 'en'` is a fixed default, not
 * a guess from the browser, matching ThemeToggle's own "never guess from
 * OS preference" precedent. auth-context.tsx calls changeLanguage() once
 * the signed-in user's own account preference is known.
 *
 * Only the `common` namespace exists so far - shared chassis/chrome
 * strings only, per this stage's scope. Per-page namespaces are later
 * stages' work (DESIGN_SWAHILI_UI.md), not built ahead of need here.
 */
void i18n.use(initReactI18next).init({
  resources: {
    en: { common: en },
    sw: { common: sw },
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
