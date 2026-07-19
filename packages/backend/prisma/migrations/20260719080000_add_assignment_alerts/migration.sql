-- CreateEnum
CREATE TYPE "payment_alert_kind" AS ENUM ('NO_PAYMENT', 'SHORTFALL');

-- CreateTable
CREATE TABLE "assignment_alerts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "daily_assignment_id" TEXT NOT NULL,
    "kind" "payment_alert_kind" NOT NULL,
    "target_amount" DECIMAL(10,2) NOT NULL,
    "paid_amount" DECIMAL(10,2) NOT NULL,
    "sent_to" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assignment_alerts_daily_assignment_id_key" ON "assignment_alerts"("daily_assignment_id");

-- CreateIndex
CREATE INDEX "assignment_alerts_tenant_id_idx" ON "assignment_alerts"("tenant_id");

-- AddForeignKey
ALTER TABLE "assignment_alerts" ADD CONSTRAINT "assignment_alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_alerts" ADD CONSTRAINT "assignment_alerts_daily_assignment_id_fkey" FOREIGN KEY ("daily_assignment_id") REFERENCES "daily_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
