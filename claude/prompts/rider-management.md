# Rider Management module

Build the Rider management module for the backend, following the same patterns as
the motorcycle, payment, and assignment modules. Read
claude/SECURITY_AND_SCALING_REQUIREMENTS.md first and satisfy the relevant items.

## Context
- This is the last master-data module. It is slightly more involved than motorcycle
  management because a rider needs a LOGIN, so creating a rider means creating BOTH a
  User (role RIDER) and a Rider profile, in one transaction.
- Relevant schema (already exists):
  - User: tenantId, email, phone, passwordHash, role, firstName, lastName, isActive.
    Unique [tenantId, email] and [tenantId, phone].
  - Rider: tenantId, userId (unique, FK to User), licenseNumber, nationalId?,
    emergencyContact?, isActive, deletedAt. Unique [tenantId, licenseNumber].
- Reuse the existing password hashing util (bcrypt) from the auth module, the
  RolesGuard + @Roles(), the RequestContextInterceptor, and PrismaService. Do not
  bypass PrismaService.

## Access control
- OWNER and MANAGER: create / list / get / update / deactivate riders.
- RIDER and MECHANIC: no access to these management endpoints (403). (A rider already
  reads their own profile via /auth/me — do not duplicate that here.)

## Build (packages/backend/src/modules/rider/)
- DTOs (class-validator, strict):
  - CreateRiderDto: firstName, lastName, phone, email, licenseNumber (all required,
    non-empty, trimmed), initialPassword (required, min length e.g. 8),
    nationalId?, emergencyContact?.
  - UpdateRiderDto: all optional — firstName, lastName, phone, licenseNumber,
    nationalId, emergencyContact. (Email and password changes are out of scope for
    this module; keep it focused.)
- RiderService:
  - create: run inside a Prisma transaction — hash initialPassword, create the User
    (role RIDER, isActive true), then create the Rider profile linked to that user.
    Reject a duplicate email or phone (User uniqueness) and a duplicate licenseNumber
    (Rider uniqueness) with ConflictException; catch the DB P2002 unique violation as
    a race-safe backstop. Never return the passwordHash in the response.
  - list: exclude soft-deleted (isActive false / deletedAt set) by default; include
    the linked user's firstName, lastName, phone (never the passwordHash); support a
    search on name or licenseNumber; order by createdAt desc.
  - get: by id, include the user's public fields (no passwordHash); 404 (not 403) if
    missing or not visible.
  - update: OWNER/MANAGER; apply partial changes to the rider profile and the user's
    name/phone; re-check phone and licenseNumber uniqueness if they change.
  - deactivate (soft delete): OWNER/MANAGER; set rider.isActive=false + deletedAt, AND
    set the linked user.isActive=false so the rider can no longer log in. Do NOT
    hard-delete — assignment and payment history reference the rider and must survive.
- RiderController: POST /riders, GET /riders, GET /riders/:id, PATCH /riders/:id,
  DELETE /riders/:id (soft delete). @UseGuards(JwtAuthGuard, RolesGuard) at class
  level, @Roles() per route.
- Register RiderModule in AppModule.

## Tests (run live against the real Postgres/Redis Docker containers before committing)
- Unit (mock PrismaService): create success (User + Rider in a transaction, no
  passwordHash leaked); duplicate email -> Conflict; duplicate licenseNumber ->
  Conflict; deactivate sets rider AND user inactive; a RIDER create attempt ->
  Forbidden.
- E2E (auth-e2e style, real containers): owner signs up, creates a rider; the new
  rider can log in with the initialPassword (end-to-end proof the account works);
  owner lists and sees the rider; owner deactivates the rider and that rider can no
  longer log in; assert tenant isolation (tenant A cannot see tenant B's riders);
  assert a RIDER token gets 403 on create.

Show me the diff before pushing to main.
