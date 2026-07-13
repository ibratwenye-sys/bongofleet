# syntax=docker/dockerfile:1
# Build context is the repo root (see docker-compose.yml) - this image needs the
# whole pnpm workspace to resolve @bongofleet/shared-lib and the workspace lockfile,
# not just packages/backend in isolation.
FROM node:22-alpine

# python3/make/g++ are required for bcrypt's node-gyp native build on Alpine.
RUN apk add --no-cache python3 make g++

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /workspace

# Copy just the manifests first so `pnpm install` is cached across builds unless a
# dependency actually changed. pnpm needs every workspace member's package.json
# present to resolve the lockfile, even though this image only builds backend +
# shared-lib.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/backend/package.json packages/backend/package.json
COPY packages/shared-lib/package.json packages/shared-lib/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json
COPY packages/mobile-app/package.json packages/mobile-app/package.json

# registry.npmjs.org has been observed to be slow/flaky from this environment (many
# tarball fetches under 50 KiB/s, some timing out outright). pnpm's default
# concurrency spreads the already-limited bandwidth across many parallel requests,
# making that worse, not better - reduce it and be more patient with retries.
RUN pnpm config set network-concurrency 4 && \
    pnpm config set fetch-retries 5 && \
    pnpm config set fetch-retry-mintimeout 20000 && \
    pnpm config set fetch-retry-maxtimeout 120000 && \
    pnpm config set store-dir /pnpm-store

# Installs entirely inside the Linux image - never bind-mount the host's
# node_modules into this container, it corrupts native bindings (bcrypt) built for
# the wrong platform. The cache mount means a retried build (see above - this
# connection needs retries) reuses whatever was already downloaded instead of
# starting from zero every time.
RUN --mount=type=cache,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter "@bongofleet/backend..."

COPY packages/shared-lib packages/shared-lib
COPY packages/backend packages/backend

RUN pnpm --filter @bongofleet/shared-lib build

# `prisma generate` only reads the schema to emit client code - it never connects to
# a database - but prisma.config.ts's env('DATABASE_URL') throws if the variable
# isn't resolvable at all, and docker-compose's `environment:` block only exists at
# container *runtime*, not during `docker build`. A placeholder value satisfies the
# config loader here; the real DATABASE_URL from compose is what's actually used
# later, at container start, by `prisma migrate deploy` and the app itself.
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
    pnpm --filter @bongofleet/backend run db:generate
RUN pnpm --filter @bongofleet/backend run build

WORKDIR /workspace/packages/backend
EXPOSE 3000

# migrate deploy is idempotent - safe to run on every container start, applies any
# migrations that haven't landed yet and no-ops otherwise.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
