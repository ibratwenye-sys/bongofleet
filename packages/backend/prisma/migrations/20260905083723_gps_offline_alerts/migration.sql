-- CreateTable
CREATE TABLE "gps_offline_alerts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "motorcycle_id" TEXT NOT NULL,
    "alert_date" DATE NOT NULL,
    "last_recorded_at" TIMESTAMP(3),
    "sent_to" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gps_offline_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gps_offline_alerts_tenant_id_idx" ON "gps_offline_alerts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "gps_offline_alerts_motorcycle_id_alert_date_key" ON "gps_offline_alerts"("motorcycle_id", "alert_date");

-- AddForeignKey
ALTER TABLE "gps_offline_alerts" ADD CONSTRAINT "gps_offline_alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_offline_alerts" ADD CONSTRAINT "gps_offline_alerts_motorcycle_id_fkey" FOREIGN KEY ("motorcycle_id") REFERENCES "motorcycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
