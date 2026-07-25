CREATE TYPE "TransportJobStatus" AS ENUM ('SCHEDULED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');

CREATE TABLE "transport_jobs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "motorcycle_id" TEXT NOT NULL,
  "rider_id" TEXT,
  "owner_driven" BOOLEAN NOT NULL DEFAULT false,
  "reference" TEXT,
  "origin" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "cargo" TEXT,
  "revenue" DECIMAL(12,2) NOT NULL,
  "status" "TransportJobStatus" NOT NULL DEFAULT 'SCHEDULED',
  "scheduled_date" DATE NOT NULL,
  "picked_up_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transport_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "transport_jobs_reference_key" ON "transport_jobs"("reference");
CREATE INDEX "transport_jobs_tenant_id_idx" ON "transport_jobs"("tenant_id");
CREATE INDEX "transport_jobs_motorcycle_id_idx" ON "transport_jobs"("motorcycle_id");

ALTER TABLE "transport_jobs" ADD CONSTRAINT "transport_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transport_jobs" ADD CONSTRAINT "transport_jobs_motorcycle_id_fkey" FOREIGN KEY ("motorcycle_id") REFERENCES "motorcycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transport_jobs" ADD CONSTRAINT "transport_jobs_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "expenses" ADD COLUMN "transport_job_id" TEXT;
CREATE INDEX "expenses_transport_job_id_idx" ON "expenses"("transport_job_id");
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_transport_job_id_fkey" FOREIGN KEY ("transport_job_id") REFERENCES "transport_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
