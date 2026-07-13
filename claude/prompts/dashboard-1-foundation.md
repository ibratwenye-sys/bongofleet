# Owner Dashboard — Stage 1: Foundation & Login

Build the foundation of the fleet-owner web dashboard in packages/dashboard. This is
Stage 1 of 3 — the goal is a running app an owner can log into and see real KPIs.
Do NOT build the fleet/rider/assignment/payment management screens yet (those are
Stages 2 and 3) — but DO put navigation placeholders for them in the app shell.

Build functional-first: clean, simple, readable UI. Working end-to-end matters more
than visual polish.

## Current state
- packages/dashboard is a Vite + React 18 + TypeScript scaffold. No Tailwind, no
  router, no API client yet.
- The backend runs on http://localhost:3000. Vite dev server runs on
  http://localhost:5173.

## Backend API (already built — do not change the backend except the CORS note below)
- POST /auth/login  body {email, password}  -> 200 {accessToken, refreshToken, expiresIn}
- POST /auth/refresh  body {refreshToken}    -> 200 {accessToken, refreshToken, expiresIn}
  (refresh tokens ROTATE — every refresh returns a NEW refreshToken; always store the
  latest one.)
- GET  /auth/me  (Bearer access token)       -> {id, tenantId, email, role, firstName, lastName}
- POST /auth/logout (Bearer)                 -> 204
- GET  /payments?status=&startDate=&endDate= (Bearer) -> list
- GET  /assignments?startDate=&endDate=      (Bearer) -> list
- GET  /motorcycles                          (Bearer) -> list
- GET  /riders                               (Bearer) -> list

## CORS (one small backend change is allowed here)
- Ensure the backend's CORS allowlist includes http://localhost:5173. Add it to
  CORS_ORIGINS in .env and .env.example if not already present. Login is done via the
  Authorization header (Bearer), not cookies.

## Build
1. Tooling: add TailwindCSS (with its Vite/PostCSS config) and react-router-dom.
   Keep it minimal — no component library.
2. API client (src/lib/api.ts): a fetch wrapper with a configurable base URL
   (VITE_API_URL, default http://localhost:3000) that:
   - attaches the in-memory access token as a Bearer header;
   - on a 401, calls /auth/refresh ONCE with the stored refresh token, saves the new
     tokens, and retries the original request;
   - if refresh fails, clears tokens and redirects to /login.
3. Token storage: keep the access token in memory; persist the refresh token in
   localStorage so a page reload can re-authenticate. On app boot, if a refresh token
   exists, call /auth/refresh to get an access token, then GET /auth/me. (localStorage
   is fine here — this is a real app the user runs, not a sandboxed artifact.)
4. Auth context + protected routes: track the current user (from /auth/me). Any route
   except /login redirects to /login when not authenticated.
5. Screens:
   - Login (/login): email + password form -> POST /auth/login -> store tokens ->
     redirect to /. Show a clear error on bad credentials (401).
   - App shell (protected layout): a simple sidebar or top nav showing the app name,
     the logged-in owner's name, a Logout button (POST /auth/logout then clear tokens
     and go to /login), and nav links: Dashboard (active), plus Fleet, Riders,
     Assignments, Payments as visible-but-placeholder links (route to a simple
     "Coming soon" stub for now).
   - Dashboard home (/): KPI cards computed CLIENT-SIDE from the list endpoints (there
     is no dedicated KPI endpoint yet):
       * Today's revenue — sum of COMPLETED payments paid today
       * Pending payments — count of payments with status PENDING
       * Today's assignments — count of assignments dated today
       * Fleet size — count of active motorcycles
     Show a loading state while fetching and a friendly empty state (zeros) for a brand
     new account.

## Verify before committing
- `pnpm --filter @bongofleet/dashboard build` and `lint` both pass clean.
- With Docker up and the backend running, do an end-to-end smoke check: create an owner
  via POST /auth/signup, log in through the UI, confirm the dashboard loads and /auth/me
  populates the owner's name, confirm Logout returns you to /login, and confirm a page
  reload keeps you logged in (refresh-token path works).
- Note in your summary how to run it (docker up, backend dev server, `pnpm --filter
  @bongofleet/dashboard dev`).

Show me the diff before pushing to main.
