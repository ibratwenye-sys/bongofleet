# Motorcycle Management module

Build the Motorcycle management module for the backend, following the same patterns
as the payment and assignment modules. Read
claude/SECURITY_AND_SCALING_REQUIREMENTS.md first and satisfy the relevant items.

## Context
- The Motorcycle model already exists in prisma/schema.prisma:
  tenantId, registrationNumber, make?, model?, year?, gpsDeviceId?,
  status (ACTIVE | MAINTENANCE | RETIRED, default ACTIVE), isActive, deletedAt.
  Unique constraints: [tenantId, registrationNumber] and [tenantId, gpsDeviceId].
- All queries go through PrismaService (tenant-scoping is automatic). Reuse the
  existing RolesGuard + @Roles() and the RequestContextInterceptor. Do not bypass
  PrismaService.
- This is the "master data" that assignments depend on — an owner needs it to put
  bikes into the system before assigning riders.

## Access control
- OWNER and MANAGER: full create / list / get / update / deactivate.
- RIDER and MECHANIC: no access to these endpoints (403).

## Build (packages/backend/src/modules/motorcycle/)
- DTOs (class-validator, strict):
  - CreateMotorcycleDto: registrationNumber (required, non-empty, trimmed),
    make?, model?, year? (@IsInt, sane range e.g. 1980..2100),
    gpsDeviceId?, status? (enum, defaults to ACTIVE).
  - UpdateMotorcycleDto: all fields optional (make, model, year, gpsDeviceId,
    status). registrationNumber is editable but must stay unique in the tenant.
- MotorcycleService:
  - create: reject a duplicate registrationNumber or gpsDeviceId in the tenant
    (ConflictException); catch the DB P2002 unique violation as a race-safe
    backstop, same as the assignment module; create with status ACTIVE by default.
  - list: exclude soft-deleted (isActive=false / deletedAt set) by default; support
    filter by status and a search on registrationNumber; order by createdAt desc.
  - get: by id, include nothing heavy; 404 (not 403) if missing or not visible.
  - update: OWNER/MANAGER; apply partial changes; re-check uniqueness if
    registrationNumber or gpsDeviceId changes.
  - deactivate (soft delete): OWNER/MANAGER; set isActive=false, deletedAt=now.
    Do NOT hard-delete — maintenance/assignment/GPS history must stay intact.
    A deactivated bike stops appearing in the default list but its history remains.
- MotorcycleController: POST /motorcycles, GET /motorcycles, GET /motorcycles/:id,
  PATCH /motorcycles/:id, DELETE /motorcycles/:id (soft delete).
  @UseGuards(JwtAuthGuard, RolesGuard) at class level, @Roles() per route.
- Register MotorcycleModule in AppModule.

## Tests (run live against the real Postgres/Redis Docker containers before committing)
- Unit (mock PrismaService): create success; duplicate registrationNumber ->
  Conflict; duplicate gpsDeviceId -> Conflict; update changes status; deactivate
  sets isActive=false + deletedAt; a RIDER create attempt -> Forbidden.
- E2E (auth-e2e style, real containers): owner signs up, creates a motorcycle,
  lists it, updates its status to MAINTENANCE, deactivates it and confirms it drops
  from the default list; assert tenant isolation (tenant A cannot see tenant B's
  motorcycles); assert a RIDER token gets 403 on create.

Show me the diff before pushing to main.
