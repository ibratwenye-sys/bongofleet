import type { Theme } from './types';

/**
 * Stage UI1 (DESIGN_THEMING.md) - dark is the default with NO attribute on
 * <html> (index.css's bare :root block); light is the only state that ever
 * needs an explicit attribute. Applying `theme ?? null` (never guessing
 * from OS preference, per the design doc) means a signed-out visitor and a
 * signed-in owner who never chose a theme both render identically dark.
 */
export function applyTheme(theme: Theme | null): void {
  if (theme === 'LIGHT') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}
