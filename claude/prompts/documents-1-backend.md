# Documents, Expiry Tracking & Guarantors — Stage 1 (Backend)

Build the backend for rider/motorcycle document storage with expiry tracking, plus
rider guarantors. This is Stage 1 of 2 (backend now; dashboard screens next). Follow
the same patterns as the existing modules and read
claude/SECURITY_AND_SCALING_REQUIREMENTS.md first.

## Goal
- Store documents for riders (National ID, Driver's License, LATRA), motorcycles
  (Insurance, Registration Card), and guarantors (their ID). Each document has a
  reference number, an optional expiry date, and an uploaded file (photo/scan).
- Track expiry: a document expiring within 30 days is "expiring soon"; past its date
  is "expired".
- Store guarantors for a rider (support two or more per rider).

## Data model (Prisma — add models + a migration)
- Enums:
  - DocumentOwnerType: RIDER | MOTORCYCLE | GUARANTOR
  - DocumentType: NATIONAL_ID | DRIVERS_LICENSE | LATRA | INSURANCE |
    REGISTRATION_CARD | GUARANTOR_ID | OTHER
- Guarantor: id, tenantId, riderId (FK, onDelete Restrict), firstName, lastName,
  phone, relationship? , nationalId?, isActive (default true), deletedAt?, timestamps.
  Index on [tenantId], [riderId].
- Document: id, tenantId, ownerType (DocumentOwnerType), ownerId (the rider,
  motorcycle, or guarantor id — polymorphic by ownerType), docType (DocumentType),
  referenceNumber?, expiryDate? (Date), fileName, mimeType, storageKey (path on disk),
  sizeBytes, uploadedAt, timestamps. Index on [tenantId], [ownerType, ownerId],
  [tenantId, expiryDate].
- Keep the existing Rider.nationalId / Rider.licenseNumber fields as-is (do not break
  them); the new Document records are additive.

## File storage
- Store uploaded files on disk under an uploads directory mounted as a Docker volume
  (add the volume to the backend service in docker-compose.yml so files survive
  container restarts). Save a per-tenant subpath; the DB stores storageKey + metadata.
- Do NOT store file bytes in Postgres.
- Accept only image/jpeg, image/png, application/pdf; max size 10 MB. Reject anything
  else with a clear 400.

## Endpoints (all @UseGuards(JwtAuthGuard, RolesGuard), OWNER/MANAGER; tenant-scoped)
Documents:
- POST   /documents            multipart/form-data: file + {ownerType, ownerId, docType,
                               referenceNumber?, expiryDate?}. Validate the owner exists
                               and belongs to the tenant. Use FileInterceptor.
- GET    /documents?ownerType=&ownerId=   list document metadata (never the bytes).
- GET    /documents/:id/file   stream/download the file (auth + tenant-scoped).
- DELETE /documents/:id        remove the record and its file.
- GET    /documents/expiring?withinDays=30   list documents across the tenant that are
                               expired or expiring within N days (default 30), each
                               with a computed status: VALID | EXPIRING_SOON | EXPIRED,
                               and enough owner info to display (owner type + a label).
Guarantors:
- POST   /riders/:riderId/guarantors     create a guarantor for a rider.
- GET    /riders/:riderId/guarantors     list a rider's guarantors.
- PATCH  /guarantors/:id                 update.
- DELETE /guarantors/:id                 soft delete.
  (Allow any number of guarantors; do not hard-block on a minimum — the UI will
  encourage at least two.)

## DTOs (class-validator, strict)
- CreateDocumentDto (the non-file fields): ownerType enum, ownerId UUID, docType enum,
  referenceNumber?, expiryDate? (ISO date).
- CreateGuarantorDto: firstName, lastName, phone (required); relationship?, nationalId?.
- UpdateGuarantorDto: all optional.
- Compute the VALID/EXPIRING_SOON/EXPIRED status in the service from expiryDate and a
  30-day window; do not trust a status sent by the client.

## Security / correctness
- Everything tenant-scoped via PrismaService (no bypass). The file-download endpoint
  must confirm the document belongs to the caller's tenant before streaming.
- Reuse RolesGuard + RequestContextInterceptor. Catch unique/constraint issues cleanly.
- Never serve a file path from user input directly — resolve via the stored record.

## Tests (run live against the real Postgres/Redis containers before committing)
- Unit (mock Prisma): create-document validates owner + rejects a bad mime type;
  expiring query classifies VALID/EXPIRING_SOON/EXPIRED correctly around the 30-day
  boundary; create-guarantor success; a RIDER-role token is forbidden.
- E2E (auth-e2e style, real containers): owner signs up, creates a rider + motorcycle,
  uploads a document (small test image) for each, lists them, downloads one back and
  confirms the bytes match, sets an expiry in ~10 days and confirms it shows
  EXPIRING_SOON in /documents/expiring, adds two guarantors to the rider and lists
  them, and asserts tenant isolation (tenant A cannot download tenant B's file).

Show me the diff before pushing to main.
