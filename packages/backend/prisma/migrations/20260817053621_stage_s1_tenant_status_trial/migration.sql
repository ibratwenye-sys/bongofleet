-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "billing_exempt_at" TIMESTAMP(3),
ADD COLUMN     "status" "tenant_status" NOT NULL DEFAULT 'PENDING_VERIFICATION',
ADD COLUMN     "trial_ends_at" TIMESTAMP(3),
ADD COLUMN     "verified_at" TIMESTAMP(3);

-- Stage S1 - hand-added data fix, not Prisma-generated. The column default
-- above is for tenants created AFTER this migration; every row that already
-- exists when this runs predates verification entirely and must not be
-- retroactively locked out by it. Grandfathered ACTIVE, verified_at backdated
-- to when they actually started (created_at, not "now"), trial_ends_at left
-- NULL - which is what "no trial clock running" means, exactly the state a
-- pre-trial account should be in. Anything created by THIS migration's own
-- default (there is none, but future migrations must not assume otherwise)
-- is untouched.
UPDATE "tenants" SET "status" = 'ACTIVE', "verified_at" = "created_at";

-- Ibrahim's own fleet is the first tenant this system ever had - literally,
-- by created_at, not by matching a specific seed email that may not exist in
-- every database this migration runs against. His own product must never
-- lock him out of it or bill him, and that guarantee needs to survive every
-- future change to the lock predicate, not just hold under today's rules -
-- which is what billing_exempt_at is for (see checkTenantLock: it overrides
-- everything else, unconditionally). Grandfathering to ACTIVE above already
-- leaves him unlocked today; this is the belt as well as the braces.
UPDATE "tenants"
SET "billing_exempt_at" = "created_at"
WHERE "id" = (SELECT "id" FROM "tenants" ORDER BY "created_at" ASC LIMIT 1);
