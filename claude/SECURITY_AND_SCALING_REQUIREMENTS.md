# BongoFleet — Security & Scaling Requirements

These rules apply to **every module** we build. Any new endpoint, service, or
integration must satisfy the relevant items below. Treat this as a checklist to
review against before committing any feature.

Status legend: DONE already in place · PARTIAL · TODO not yet · LATER applies once
the feature exists.

---

## 1. Security — critical mistakes to avoid

### 1.1 Never trust the frontend — validate on the backend (DONE)
- All validation happens server-side via the global `ValidationPipe`
  (`whitelist: true`, `transform: true`). The frontend is a convenience, never a
  gatekeeper.
- Business rules (amount caps, state transitions, ownership checks) live in the
  **service layer**, not the client.

### 1.2 Broken access control (PARTIAL — biggest current gap)
- **Horizontal (tenant) isolation — DONE.** The Prisma tenant-scoping extension
  auto-filters every query by `tenantId` and throws if context is missing
  (fail-closed). Never bypass `PrismaService` to dodge this.
- **Vertical (role) authorization — TO BUILD.** `role` is captured in
  `requestContext` but not enforced. Add a `RolesGuard` + `@Roles(...)` decorator
  and put it on every privileged route. Rule of thumb:
  - OWNER / MANAGER: create/modify assignments, reconcile payments, view finances.
  - RIDER: only their own assignments/payments (validate ownership, not just role).
  - MECHANIC: maintenance endpoints only.
- Never trust an ID from the request body as proof of ownership — cross-check it
  against `requestContext` (e.g. a rider recording a payment must match the
  assignment's rider).

### 1.3 Business logic abuse (PARTIAL)
- Enforce invariants in the service: amount caps, valid state transitions, "can't
  delete records with history," uniqueness (one bike ↔ one rider per day).
- Assume every input is hostile: negative amounts, future/past dates, duplicate
  submissions, replayed requests.

### 1.4 External APIs (M-Pesa, GPS, SMS) (LATER)
- Set explicit timeouts and retry with backoff; never block a request forever.
- Keep all keys/secrets in env, never in code or the repo.
- Validate and type every response — never trust an external payload shape.
- Verify webhook signatures before acting on a callback.

### 1.5 SSRF (LATER)
- Never fetch a URL supplied (directly or indirectly) by a user without an
  allowlist of permitted hosts. Relevant once webhooks / image URLs / callbacks
  exist.

### 1.6 Sensitive data (DONE mostly)
- Passwords: bcrypt (cost 12). Refresh tokens: SHA-256 hashed in Redis. Secrets in
  env. JWT expiry enforced (access 15m, refresh 7d).
- `.env` must stay gitignored (it is). Never log tokens, passwords, or full PII.
- Consider field-level encryption for PII (nationalId, licenseNumber) before
  production; acceptable unencrypted for MVP.

### 1.7 Input validation (DONE)
- class-validator DTOs on every endpoint; `whitelist` strips unknown fields.
- Tighten as we go: `@IsPositive` on money, `@Max`/`@MaxLength` bounds, enum
  constraints on status/method fields.

### 1.8 Rate limiting (TODO — add next)
- Add `@nestjs/throttler` globally, with a stricter limit on `/auth/login` and
  `/auth/refresh` to stop brute-force and token-guessing.

### 1.9 API inventory (TODO — add soon)
- Add `@nestjs/swagger` so every endpoint is documented in one place — knowing the
  full surface is itself a security control.

### 1.10 Configuration hardening (PARTIAL)
- Add `helmet` for security headers.
- Replace open `enableCors()` with an explicit origin allowlist (dashboard +
  mobile origins only).
- Validate env at boot with a schema (e.g. Joi via `ConfigModule.forRoot({
  validationSchema })`) so a missing/blank secret fails fast.

---

## 2. Scaling — for 100+ concurrent users and beyond

### 2.1 Database connection pooling (DONE exists, PARTIAL tune)
- `@prisma/adapter-pg` already pools via node-postgres. Set explicit pool sizing
  (max connections, idle timeout) before load testing so we don't exhaust Postgres.

### 2.2 Caching layer (TODO — Redis is wired, not yet used as cache)
- Redis is already connected (currently only for refresh tokens). Add
  `@nestjs/cache-manager` with the Redis store and cache read-heavy, rarely-changing
  data instead of hitting Postgres every time:
  - Cache: motorcycle list, rider list, tenant/config lookups, dashboard KPI counts
    (short TTL, e.g. 30–60s).
  - Do NOT cache: anything transactional or per-request that must be exact at read
    time (a specific payment's current status during reconciliation).
  - Invalidate on write: bust the relevant cache key when the underlying data
    changes.
- Principle: if the same unchanging data is requested 100 times, serve it from
  cache — don't query the database 100 times.

---

## 3. Immediate action items (cheap now, painful later)
1. `RolesGuard` + `@Roles()` decorator, applied to all privileged routes.
2. `@nestjs/throttler` global + strict on auth routes.
3. `helmet` + CORS allowlist + env-schema validation.
4. `@nestjs/swagger` for API inventory.
5. `@nestjs/cache-manager` (Redis) on read-heavy endpoints.
6. Explicit Postgres pool sizing.

Ownership checks (item 1.2) and business-rule enforcement (1.3) are built into each
feature as it's created, not deferred.
