import { useState } from 'react';
import { useAuth } from '../lib/auth-context';
import type { Theme } from '../lib/types';

/**
 * Stage UI1 (DESIGN_THEMING.md) - the top-bar light/dark toggle. Reads/
 * writes the account's theme (auth-context.tsx's setTheme), never
 * browser storage, so it's the same on every device the owner signs into.
 * Falls back to dark when the user has never chosen (theme: null) -
 * never guesses from OS preference.
 *
 * Two buttons, each SETTING its own explicit state rather than both
 * flipping a shared toggle - clicking "Light theme" while already light
 * must be a harmless no-op, not flip back to dark.
 */
export function ThemeToggle() {
  const { user, setTheme } = useAuth();
  const [pending, setPending] = useState(false);
  const isLight = user?.theme === 'LIGHT';

  async function choose(theme: Theme) {
    if (pending) return;
    setPending(true);
    try {
      await setTheme(theme);
    } catch {
      // Best-effort - the toggle just stays showing the last-applied theme.
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center rounded-full border border-line bg-panel-2 p-0.5">
      <button
        type="button"
        onClick={() => void choose('DARK')}
        aria-pressed={!isLight}
        aria-label="Dark theme"
        title="Dark theme"
        disabled={pending}
        className={`rounded-full px-2 py-1 text-sm ${!isLight ? 'bg-panel text-txt' : 'text-txt-3'}`}
      >
        🌙
      </button>
      <button
        type="button"
        onClick={() => void choose('LIGHT')}
        aria-pressed={isLight}
        aria-label="Light theme"
        title="Light theme"
        disabled={pending}
        className={`rounded-full px-2 py-1 text-sm ${isLight ? 'bg-panel text-txt' : 'text-txt-3'}`}
      >
        ☀
      </button>
    </div>
  );
}
