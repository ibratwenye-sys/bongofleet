# Fleet document types + Reactivation — Backend

Two backend changes, following existing patterns. Read
claude/SECURITY_AND_SCALING_REQUIREMENTS.md first. Commit as two commits.

## Commit 1 — new fleet document types
- In prisma/schema.prisma, add three values to the DocumentType enum:
  VEHICLE_INSPECTION, ROAD_SAFETY_WEEK, and TBS_CERTIFICATE. (LATRA already exists and
  stays.) TBS_CERTIFICATE is an optional motorcycle document (used for delivery bikes).
- Generate and apply a migration against the real Postgres container.
- No data backfill needed. These new types will be used on the motorcycle side in the
  frontend (LATRA moves to the motorcycle side there too, but that is a frontend change
  — the enum itself already has LATRA).
- A quick unit test / assertion that the enum accepts the new values is enough here.

## Commit 2 — reactivation of deactivated riders and motorcycles
Right now deactivating is one-way: a soft-deleted rider/motorcycle is hidden and there
is no way to bring it back. Add that.

- Rider list (GET /riders) and Motorcycle list (GET /motorcycles): accept an optional
  `includeInactive=true` query param. Default behaviour is unchanged (active only);
  when true, also return deactivated (isActive=false / deletedAt set) records, each
  clearly carrying its isActive/deletedAt so the UI can mark them.
- Add reactivate endpoints (OWNER/MANAGER only, tenant-scoped, JwtAuthGuard+RolesGuard):
  - PATCH /riders/:id/reactivate — set the rider isActive=true, deletedAt=null, AND
    re-enable the linked User (isActive=true) so the rider can log in again.
  - PATCH /motorcycles/:id/reactivate — set isActive=true, deletedAt=null.
  - 404 if not found in the tenant; idempotent if already active is fine.

## Tests (run live against the real Postgres/Redis containers before committing)
- Unit (mock Prisma): reactivateRider flips rider + user active; reactivateMotorcycle
  flips the bike; a RIDER-role token is forbidden on both.
- E2E (auth-e2e style): owner creates a rider, deactivates them (login now fails),
  reactivates them, and confirms the rider can log in again; deactivate + reactivate a
  motorcycle and confirm it returns to the default list; GET /riders?includeInactive=true
  shows a deactivated rider that the default list hides; assert tenant isolation.

Show me the diff before pushing each commit.
