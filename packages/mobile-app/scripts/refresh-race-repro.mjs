/**
 * Forces the refresh race that used to log riders out mid-shift, against the
 * REAL src/api.ts - not a re-implementation of it.
 *
 * Why this exists rather than a test: packages/mobile-app has no test runner
 * (the same gap the dashboard had before Stage H2), and adding jest-expo
 * mid-fix would have been a bigger change than the fix. This is the same
 * approach used to prove the dashboard's version of this bug: force the
 * timing, count the requests, print the session state.
 *
 * It runs api.ts through esbuild with two modules stubbed - AsyncStorage
 * (in-memory) and expo-constants (points API_URL at the local backend) -
 * so the code under test is the shipped source, not a copy of it.
 *
 * Needs the backend up and seeded (see VISUAL_CHECK.md steps 1-2):
 *   node packages/mobile-app/scripts/refresh-race-repro.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const EMAIL = process.env.SEED_EMAIL ?? 'owner@bongofleet.com';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Test1234!';

// esbuild arrives as a transitive dependency of the dashboard's vite. Under
// pnpm's strict layout that means it is NOT resolvable from the repo root or
// from this package - only from vite's own directory - so hop through vite
// rather than adding a dependency to mobile-app for a diagnostic script.
let esbuild;
try {
  const dashboardRequire = createRequire(
    path.join(REPO_ROOT, 'packages', 'dashboard', 'package.json'),
  );
  const viteRequire = createRequire(dashboardRequire.resolve('vite/package.json'));
  esbuild = viteRequire('esbuild');
} catch (err) {
  console.error(
    'Could not resolve esbuild via the dashboard\'s vite - run `pnpm install` at the repo root first.\n' +
      `  (${err instanceof Error ? err.message : String(err)})`,
  );
  process.exit(1);
}

/** In-memory stand-ins for the two native modules api.ts pulls in. */
function stubs(store) {
  return {
    name: 'native-stubs',
    setup(build) {
      build.onResolve({ filter: /^@react-native-async-storage\/async-storage$/ }, () => ({
        path: 'async-storage-stub',
        namespace: 'stub',
      }));
      build.onResolve({ filter: /^expo-constants$/ }, () => ({
        path: 'expo-constants-stub',
        namespace: 'stub',
      }));
      build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
        if (args.path === 'expo-constants-stub') {
          return {
            contents: `export default { expoConfig: { extra: { apiUrl: ${JSON.stringify(API_URL)} } } };`,
            loader: 'js',
          };
        }
        return {
          contents: `
            const store = globalThis.__STORE__;
            export default {
              getItem: async (k) => (k in store ? store[k] : null),
              setItem: async (k, v) => { store[k] = v; },
              multiSet: async (pairs) => { for (const [k, v] of pairs) store[k] = v; },
              multiRemove: async (keys) => { for (const k of keys) delete store[k]; },
            };
          `,
          loader: 'js',
        };
      });
    },
  };
}

/** Bundle a given api.ts source string into a loadable data: module. */
async function loadApi(source, store) {
  const result = await esbuild.build({
    stdin: { contents: source, resolveDir: SRC_DIR, sourcefile: 'api.ts', loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    plugins: [stubs(store)],
    logLevel: 'silent',
  });
  // Unique suffix per load: identical sources would otherwise hit Node's
  // data: URL module cache and hand back the previous run's module, complete
  // with its captured store and its in-flight state.
  const code = result.outputFiles[0].text + `
//${randomUUID()}`;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

// Read from disk, not `git show :path` - that reads the index, so an
// unstaged fix silently compares HEAD against itself and "proves" nothing.
const currentSource = () => readFileSync(path.join(SRC_DIR, 'api.ts'), 'utf8');
const headSource = () =>
  execFileSync('git', ['show', 'HEAD:packages/mobile-app/src/api.ts'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

async function realLogin() {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} - is the backend up and seeded?`);
  return res.json();
}

/**
 * Scenario A - the race itself. Three calls start together (exactly what
 * HomeScreen does: /auth/me + /assignments + /payments) with a stale access
 * token, so all three 401 at once. The first /auth/refresh is held open long
 * enough that any un-deduplicated caller has fired its own.
 */
async function scenarioRace(source, label) {
  const store = {};
  const tokens = await realLogin();
  store['bf.accessToken'] = 'stale-access-token-forcing-401';
  store['bf.refreshToken'] = tokens.refreshToken;
  globalThis.__STORE__ = store;

  let refreshRequests = 0;
  let sessionExpiredFired = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/auth/refresh')) {
      refreshRequests += 1;
      if (refreshRequests === 1) await new Promise((r) => setTimeout(r, 800));
    }
    return realFetch(url, opts);
  };

  const api = await loadApi(source, store);
  api.setOnSessionExpired(() => {
    sessionExpiredFired = true;
  });

  const today = new Date().toISOString().slice(0, 10);
  const results = await Promise.allSettled([
    api.apiFetch('/auth/me'),
    api.apiFetch(`/assignments?dateFrom=${today}&dateTo=${today}`),
    api.apiFetch('/payments'),
  ]);
  globalThis.fetch = realFetch;

  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const firstErr = results.find((r) => r.status === 'rejected')?.reason;
  if (process.env.DEBUG_REPRO && firstErr) {
    console.log(
      `    [debug] first rejection: ${firstErr?.constructor?.name} status=${firstErr?.status} msg=${String(firstErr?.message).slice(0, 90)}`,
    );
  }
  console.log(
    `  ${label.padEnd(22)} refresh requests: ${refreshRequests}   ` +
      `calls ok: ${ok}/3   session: ${
        sessionExpiredFired || !store['bf.refreshToken'] ? 'CLEARED - rider logged out' : 'intact'
      }`,
  );
}

/**
 * Scenario B - surviving a race that was not prevented. Single-flight only
 * covers one process at one moment; this is the case it cannot cover, where
 * a refresh is already in flight with a token that something else has
 * already rotated (app backgrounded mid-refresh, a second screen mounting).
 * The in-flight call is guaranteed a 401 "already used" while storage
 * already holds a newer, valid pair.
 */
async function scenarioStaleInFlight(source, label) {
  const store = {};
  const first = await realLogin();
  // Consume `first` so the token the caller holds is genuinely spent, and
  // keep the fresh pair it produced to plant mid-flight.
  const rotatedRes = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: first.refreshToken }),
  });
  const rotated = await rotatedRes.json();

  store['bf.accessToken'] = 'stale-access-token-forcing-401';
  store['bf.refreshToken'] = first.refreshToken; // already used -> will 401
  globalThis.__STORE__ = store;

  let sessionExpiredFired = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const res = await realFetch(url, opts);
    if (String(url).includes('/auth/refresh')) {
      // "another refresh already succeeded" - lands while this one is in
      // flight, exactly as a second process would leave it.
      store['bf.accessToken'] = rotated.accessToken;
      store['bf.refreshToken'] = rotated.refreshToken;
    }
    return res;
  };

  const api = await loadApi(source, store);
  api.setOnSessionExpired(() => {
    sessionExpiredFired = true;
  });

  let outcome;
  try {
    await api.apiFetch('/auth/me');
    outcome = 'recovered - request succeeded';
  } catch (err) {
    outcome = `threw ${err?.constructor?.name ?? '?'}`;
  }
  globalThis.fetch = realFetch;

  console.log(
    `  ${label.padEnd(22)} ${outcome.padEnd(30)} session: ${
      sessionExpiredFired || !store['bf.refreshToken'] ? 'CLEARED - rider logged out' : 'intact'
    }`,
  );
}

console.log(`\nBackend: ${API_URL}`);
console.log('\nScenario A - three concurrent 401s, first refresh held open 800ms');
await scenarioRace(headSource(), 'HEAD (before)');
await scenarioRace(currentSource(), 'working tree (after)');

console.log('\nScenario B - refresh in flight with a token something else already rotated');
await scenarioStaleInFlight(headSource(), 'HEAD (before)');
await scenarioStaleInFlight(currentSource(), 'working tree (after)');
console.log('');
