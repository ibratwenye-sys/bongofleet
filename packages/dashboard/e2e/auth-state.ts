import path from 'node:path';

/**
 * Stage H0d - shared between auth.setup.ts (which writes it) and
 * playwright.config.ts (which reads it), so the two cannot drift onto
 * different paths and leave every test silently signed out.
 *
 * Absolute, anchored to this file rather than to a relative string:
 * Playwright resolves a relative storageState against the config directory,
 * but storageState({ path }) in the setup writes relative to the process
 * cwd - which differs depending on whether the suite is started from
 * packages/dashboard or from the repo root via pnpm --filter. Anchoring
 * both ends here removes the difference.
 *
 * __dirname rather than import.meta.url on purpose: this package has no
 * "type": "module", so Playwright transpiles these files to CommonJS, where
 * import.meta is a syntax error.
 *
 * The file itself holds a working refresh token and is gitignored.
 */
export const AUTH_STATE_FILE = path.join(__dirname, '..', 'playwright', '.auth', 'user.json');
