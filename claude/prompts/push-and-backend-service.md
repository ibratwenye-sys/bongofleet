# Push dashboard Stage 1, then add a backend Docker Compose service

Two commits, in order.

## Commit 1 — the dashboard Stage 1 work
Commit everything from the Owner Dashboard Stage 1 build and push to main. Include
claude/prompts/dashboard-1-foundation.md in the commit, same convention as before.

## Commit 2 — run the backend as a Docker Compose service
Goal: make `docker compose up` run the whole stack (Postgres, Redis, pgAdmin, AND the
backend API on http://localhost:3000), so the app no longer depends on a native
`pnpm dev:backend`, which fails on this machine due to the known Docker Desktop /
Windows Postgres port-forwarding bug. The backend runs inside a container on the
compose network and reaches Postgres/Redis by service name (which works reliably),
while publishing port 3000 to the host so the browser dashboard can call it.

Requirements:
1. Add packages/backend/Dockerfile that builds the backend image:
   - Install ALL dependencies INSIDE the image (Linux). Do NOT bind-mount the host's
     node_modules into the container — that previously corrupted bcrypt's native
     binding. The image must build its own node_modules so bcrypt/Prisma are compiled
     for Linux.
   - Run `prisma generate`, then build the app (nest build).
   - On container start, run `prisma migrate deploy` (idempotent) and then start the
     compiled server (node dist/main).
2. Add a `backend` service to docker-compose.yml:
   - build from the backend Dockerfile (context at repo root so it can see the
     workspace).
   - depends_on postgres and redis with condition: service_healthy (they already have
     healthchecks).
   - environment: NODE_ENV=development, PORT=3000,
     DATABASE_URL=postgresql://bongofleet:bongofleet_dev_password@postgres:5432/bongofleet
     (note: host is the service name `postgres`, NOT localhost),
     REDIS_URL=redis://redis:6379,
     JWT_ACCESS_SECRET / JWT_REFRESH_SECRET passed through from the environment,
     JWT_ACCESS_EXPIRES_IN=15m, JWT_REFRESH_EXPIRES_IN=7d,
     CORS_ORIGINS=http://localhost:5173.
   - ports: "3000:3000".
   - restart: unless-stopped.
3. Update README.md with a short "Running locally" section: `docker compose up -d --build`
   starts Postgres, Redis, pgAdmin, and the backend API; the dashboard runs separately
   with `pnpm --filter @bongofleet/dashboard dev` on http://localhost:5173.

Verify before committing:
- `docker compose up -d --build` brings the backend container up healthy.
- `GET http://localhost:3000/health` responds 200 from the host.
- A quick end-to-end check still works against the containerized backend: sign up an
  owner via the API, and confirm the dashboard (pointed at http://localhost:3000) can
  log in.

Commit this as its own commit ("chore: run backend as a docker-compose service") and
push to main.

Show me the diff before pushing each commit.
