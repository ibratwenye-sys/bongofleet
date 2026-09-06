-- AlterTable
ALTER TABLE "transport_jobs" ADD COLUMN     "amount_received" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "last_payment_received_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "transport_payment_matches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "transport_job_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "transaction_date" DATE NOT NULL,
    "narrative_text" TEXT NOT NULL,
    "source_file_name" TEXT NOT NULL,
    "matched_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transport_payment_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transport_payment_matches_tenant_id_idx" ON "transport_payment_matches"("tenant_id");

-- CreateIndex
CREATE INDEX "transport_payment_matches_transport_job_id_idx" ON "transport_payment_matches"("transport_job_id");

-- AddForeignKey
ALTER TABLE "transport_payment_matches" ADD CONSTRAINT "transport_payment_matches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_payment_matches" ADD CONSTRAINT "transport_payment_matches_transport_job_id_fkey" FOREIGN KEY ("transport_job_id") REFERENCES "transport_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
