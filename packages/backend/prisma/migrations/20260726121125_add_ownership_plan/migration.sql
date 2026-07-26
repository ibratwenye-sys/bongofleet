-- CreateEnum
CREATE TYPE "ownership_plan_status" AS ENUM ('ACTIVE', 'COMPLETED', 'DEFAULTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "daily_assignments" ADD COLUMN     "ownership_plan_id" TEXT;

-- CreateTable
CREATE TABLE "ownership_plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "motorcycle_id" TEXT NOT NULL,
    "daily_amount" DECIMAL(10,2) NOT NULL,
    "total_price" DECIMAL(12,2) NOT NULL,
    "down_payment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "start_date" DATE NOT NULL,
    "contract_end_date" DATE,
    "active_weekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "grace_days" INTEGER NOT NULL DEFAULT 0,
    "status" "ownership_plan_status" NOT NULL DEFAULT 'ACTIVE',
    "completed_at" TIMESTAMP(3),
    "defaulted_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ownership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ownership_plans_tenant_id_status_idx" ON "ownership_plans"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "ownership_plans_tenant_id_driver_id_idx" ON "ownership_plans"("tenant_id", "driver_id");

-- A vehicle may be on at most one ACTIVE plan. Prisma's schema DSL cannot
-- express a partial (WHERE) unique index, so it is hand-written here - see
-- the comment above the OwnershipPlan model in schema.prisma.
CREATE UNIQUE INDEX "ownership_plans_tenant_id_motorcycle_id_active_key"
  ON "ownership_plans" ("tenant_id", "motorcycle_id")
  WHERE "status" = 'ACTIVE';
