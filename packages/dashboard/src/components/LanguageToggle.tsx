import { useState } from 'react';
import { useAuth } from '../lib/auth-context';
import type { Language } from '../lib/types';

/**
 * Stage L1 (DESIGN_SWAHILI_UI.md) - the English/Swahili toggle, mirroring
 * ThemeToggle.tsx exactly: reads/writes the account's language (auth-
 * context.tsx's setLanguage), never browser storage, so it's the same on
 * every device. Falls back to English when the user has never chosen
 * (language: null) - never guesses from browser/OS locale.
 *
 * Two buttons, each SETTING its own explicit state rather than both
 * flipping a shared toggle - same reasoning as ThemeToggle.
 */
export function LanguageToggle() {
  const { user, setLanguage } = useAuth();
  const [pending, setPending] = useState(false);
  const isSwahili = user?.language === 'SW';

  async function choose(language: Language) {
    if (pending) return;
    setPending(true);
    try {
      await setLanguage(language);
    } catch {
      // Best-effort - the toggle just stays showing the last-applied language.
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center rounded-full border border-line bg-panel-2 p-0.5">
      <button
        type="button"
        onClick={() => void choose('EN')}
        aria-pressed={!isSwahili}
        aria-label="English"
        title="English"
        disabled={pending}
        className={`rounded-full px-2 py-1 text-xs font-medium ${!isSwahili ? 'bg-panel text-txt' : 'text-txt-3'}`}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => void choose('SW')}
        aria-pressed={isSwahili}
        aria-label="Kiswahili"
        title="Kiswahili"
        disabled={pending}
        className={`rounded-full px-2 py-1 text-xs font-medium ${isSwahili ? 'bg-panel text-txt' : 'text-txt-3'}`}
      >
        SW
      </button>
    </div>
  );
}
