# BongoFleet

Motorcycle fleet management SaaS for Tanzania.

**Stack:** NestJS (backend) · React + Vite (dashboard) · React Native/Expo (mobile-app, not yet scaffolded) · PostgreSQL · Redis

## Monorepo layout

```
BongoFleet/
├── docker-compose.yml       # Postgres, Redis, pgAdmin
├── .env.example             # copy to .env
├── packages/
│   ├── backend/             # NestJS API
│   ├── dashboard/           # React + Vite fleet-owner web dashboard
│   ├── shared-lib/          # types/enums/DTOs shared across packages
│   └── mobile-app/          # placeholder - scaffolded after payments + auth
```

Package manager: **pnpm workspaces** (no Nx/Turborepo — this repo is small enough
that plain workspaces + `pnpm -r` cover it).

## 5-minute setup

1. **Install pnpm** (skip if you already have it):
   ```bash
   corepack enable
   corepack prepare pnpm@latest --activate
   ```
   On Windows, `corepack enable` writes shims into `Program Files` and can fail
   with `EPERM` unless you're in an elevated (Administrator) shell. If it does,
   either run that command in an elevated terminal once, or skip global
   activation entirely and prefix every `pnpm` command below with
   `corepack pnpm` (e.g. `corepack pnpm install`) — no admin rights needed.

2. **Copy environment variables:**
   ```bash
   cp .env.example .env
   ```
   Defaults match `docker-compose.yml`, so local dev works with no edits.

3. **Start Postgres, Redis, and pgAdmin:**
   ```bash
   docker compose up -d
   ```
   - Postgres: `localhost:5432` (user/pass/db: `bongofleet` / `bongofleet_dev_password` / `bongofleet`)
   - Redis: `localhost:6379`
   - pgAdmin: `http://localhost:5050` (login: `admin@bongofleet.local` / `admin`)

4. **Install dependencies and set up git hooks:**
   ```bash
   pnpm install
   ```
   This also runs `prepare` (Husky), wiring up the pre-commit lint hook.

5. **Run the backend and dashboard:**
   ```bash
   pnpm dev:backend      # http://localhost:3000  — GET /health to verify
   pnpm dev:dashboard    # http://localhost:5173
   ```

You should now have the API answering at `/health` and the dashboard loading in
the browser, both talking to a Postgres/Redis stack running in Docker.

## Common commands

| Command | Description |
|---|---|
| `pnpm dev:backend` | Run NestJS API in watch mode |
| `pnpm dev:dashboard` | Run dashboard dev server |
| `pnpm build` | Build all packages |
| `pnpm lint` / `pnpm lint:fix` | Lint all packages |
| `pnpm test` | Run tests in all packages |
| `pnpm docker:up` / `pnpm docker:down` | Start/stop Postgres, Redis, pgAdmin |

## Git hooks

Husky + lint-staged run ESLint and Prettier on staged `.ts`/`.tsx`/`.json`/`.md`
files under `packages/` before each commit. The hook is installed automatically
by `pnpm install` (via the root `prepare` script) — no manual setup needed.

## Roadmap

Per the intended build order: this scaffold → payment APIs → auth → mobile app.
`mobile-app` is intentionally left as a placeholder (see
`packages/mobile-app/README.md`) until the APIs it depends on exist.
