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

3. **Start Postgres, Redis, pgAdmin, and the backend API:**
   ```bash
   docker compose up -d --build
   ```
   - Postgres: `localhost:5432` (user/pass/db: `bongofleet` / `bongofleet_dev_password` / `bongofleet`)
   - Redis: `localhost:6379`
   - pgAdmin: `http://localhost:5050` (login: `admin@bongofleet.local` / `admin`)
   - Backend API: `http://localhost:3000` — `GET /health` to verify

4. **Install dependencies and set up git hooks:**
   ```bash
   pnpm install
   ```
   This also runs `prepare` (Husky), wiring up the pre-commit lint hook. (Only
   needed for local tooling/dashboard dev - the backend container installs its own
   dependencies inside the image, see "Running locally" below.)

5. **Run the dashboard:**
   ```bash
   pnpm dev:dashboard    # http://localhost:5173
   ```

You should now have the API answering at `/health` and the dashboard loading in
the browser, both talking to a Postgres/Redis stack running in Docker.

## Running locally

The backend now runs as its own `docker compose` service (`packages/backend/Dockerfile`)
alongside Postgres/Redis/pgAdmin, rather than needing a native `pnpm dev:backend`:

```bash
docker compose up -d --build   # Postgres, Redis, pgAdmin, and the backend API
pnpm --filter @bongofleet/dashboard dev   # http://localhost:5173
```

`--build` is only needed the first time or after a dependency change - plain
`docker compose up -d` is enough otherwise. The backend container installs its own
`node_modules` inside the Linux image (never bind-mount the host's - it corrupts
native bindings like bcrypt's, built for the wrong platform), then runs
`prisma migrate deploy` (idempotent) before starting.

This is the recommended path on Windows: a native `pnpm dev:backend` can fail here
due to a Docker Desktop bug where Postgres's SCRAM auth breaks over the host's
forwarded port, even though the same container is reachable fine from other
containers on the compose network. If you're not on Windows (or that bug doesn't
affect your setup) and want hot-reload during backend development, `pnpm
dev:backend` still works the same as before - the containerized backend rebuilds
on `docker compose up -d --build` rather than watching files live, so it's better
suited to "just get the whole stack running" than active backend iteration.

## Common commands

| Command | Description |
|---|---|
| `pnpm docker:up` / `pnpm docker:down` | Start/stop Postgres, Redis, pgAdmin, and the backend API |
| `docker compose up -d --build` | Same, forcing a rebuild of the backend image after a dependency/code change |
| `pnpm dev:backend` | Run NestJS API natively in watch mode (may not work on Windows - see "Running locally") |
| `pnpm dev:dashboard` | Run dashboard dev server |
| `pnpm build` | Build all packages |
| `pnpm lint` / `pnpm lint:fix` | Lint all packages |
| `pnpm test` | Run tests in all packages |

## Git hooks

Husky + lint-staged run ESLint and Prettier on staged `.ts`/`.tsx`/`.json`/`.md`
files under `packages/` before each commit. The hook is installed automatically
by `pnpm install` (via the root `prepare` script) — no manual setup needed.

## Roadmap

Per the intended build order: this scaffold → payment APIs → auth → mobile app.
`mobile-app` is intentionally left as a placeholder (see
`packages/mobile-app/README.md`) until the APIs it depends on exist.
