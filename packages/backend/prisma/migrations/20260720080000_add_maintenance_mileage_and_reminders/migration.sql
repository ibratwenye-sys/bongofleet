-- CreateEnum
CREATE TYPE "maintenance_reminder_kind" AS ENUM ('DUE_SOON', 'OVERDUE');

-- AlterTable
ALTER TABLE "motorcycles" ADD COLUMN "current_mileage" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "maintenance_logs"
  ADD COLUMN "mileage_at_service" INTEGER,
  ADD COLUMN "next_service_date" DATE,
  ADD COLUMN "next_service_mileage" INTEGER;

-- CreateTable
CREATE TABLE "maintenance_reminders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "maintenance_log_id" TEXT NOT NULL,
    "kind" "maintenance_reminder_kind" NOT NULL,
    "sent_to" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_reminders_maintenance_log_id_kind_key" ON "maintenance_reminders"("maintenance_log_id", "kind");

-- CreateIndex
CREATE INDEX "maintenance_reminders_tenant_id_idx" ON "maintenance_reminders"("tenant_id");

-- AddForeignKey
ALTER TABLE "maintenance_reminders" ADD CONSTRAINT "maintenance_reminders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_reminders" ADD CONSTRAINT "maintenance_reminders_maintenance_log_id_fkey" FOREIGN KEY ("maintenance_log_id") REFERENCES "maintenance_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
