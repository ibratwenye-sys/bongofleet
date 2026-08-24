-- CreateTable
CREATE TABLE "subscription_pricing_tiers" (
    "id" TEXT NOT NULL,
    "min_bike_count" INTEGER NOT NULL DEFAULT 0,
    "price_per_bike_per_month" DECIMAL(10,2) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_pricing_tiers_pkey" PRIMARY KEY ("id")
);

-- Stage SUB1 - hand-added seed data, not Prisma-generated, same pattern as
-- the Stage S1 migration's billing_exempt_at backfill (see
-- 20260817053621_stage_s1_tenant_status_trial). §5b's documented future
-- shape is a 4-row tiered table (0/11/31/51 bikes -> 10k/9k/8k/7k per bike);
-- this seeds only the v1 base tier. Adding the other three rows later is a
-- migration exactly like this one, an INSERT against the same shape - NOT a
-- schema change - because there is no platform-admin role in this codebase
-- (UserRole is OWNER/MANAGER/RIDER/MECHANIC only) and therefore no dashboard
-- surface that could ever write this table.
--
-- The id is a literal, not a Prisma-generated cuid - this statement runs as
-- raw SQL outside the Prisma Client that would normally produce one, and the
-- column has no DB-side default to fall back on (see the CREATE TABLE
-- above: `id` carries no DEFAULT). Any unique string satisfies the column;
-- nothing in this codebase parses or validates cuid shape on read.
INSERT INTO "subscription_pricing_tiers"
  ("id", "min_bike_count", "price_per_bike_per_month", "effective_from", "created_at")
VALUES
  ('seed-subscription-pricing-tier-0', 0, 10000.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
