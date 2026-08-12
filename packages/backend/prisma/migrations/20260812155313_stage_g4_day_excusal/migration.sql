-- CreateEnum
CREATE TYPE "day_excusal_status" AS ENUM ('REQUESTED', 'APPROVED', 'DECLINED');

-- CreateTable
CREATE TABLE "day_excusals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ownership_plan_id" TEXT NOT NULL,
    "excused_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "day_excusal_status" NOT NULL DEFAULT 'REQUESTED',
    "requested_by_user_id" TEXT,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "day_excusals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "day_excusals_tenant_id_ownership_plan_id_excused_date_idx" ON "day_excusals"("tenant_id", "ownership_plan_id", "excused_date");

-- AddForeignKey
ALTER TABLE "day_excusals" ADD CONSTRAINT "day_excusals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
