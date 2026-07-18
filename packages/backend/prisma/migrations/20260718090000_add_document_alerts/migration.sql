-- CreateEnum
CREATE TYPE "document_alert_kind" AS ENUM ('EXPIRING_SOON', 'EXPIRED');

-- CreateTable
CREATE TABLE "document_alerts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "kind" "document_alert_kind" NOT NULL,
    "sent_to" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_alerts_document_id_kind_key" ON "document_alerts"("document_id", "kind");

-- CreateIndex
CREATE INDEX "document_alerts_tenant_id_idx" ON "document_alerts"("tenant_id");

-- AddForeignKey
ALTER TABLE "document_alerts" ADD CONSTRAINT "document_alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_alerts" ADD CONSTRAINT "document_alerts_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
