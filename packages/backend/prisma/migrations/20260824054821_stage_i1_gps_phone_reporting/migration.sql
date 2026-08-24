-- CreateEnum
CREATE TYPE "gps_source" AS ENUM ('PHONE', 'DEVICE', 'MANUAL');

-- CreateEnum
CREATE TYPE "tracking_mode" AS ENUM ('NONE', 'PHONE', 'DEVICE', 'BOTH');

-- AlterTable
ALTER TABLE "gps_locations" ADD COLUMN     "accuracy_meters" DOUBLE PRECISION,
ADD COLUMN     "battery_percent" INTEGER,
ADD COLUMN     "rider_id" TEXT,
ADD COLUMN     "source" "gps_source" NOT NULL DEFAULT 'PHONE';

-- AlterTable
ALTER TABLE "motorcycles" ADD COLUMN     "gps_device_secret_hash" TEXT,
ADD COLUMN     "tracking_mode" "tracking_mode" NOT NULL DEFAULT 'PHONE';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "tracking_end_hour" INTEGER,
ADD COLUMN     "tracking_start_hour" INTEGER;

-- CreateIndex
CREATE INDEX "gps_locations_tenant_id_motorcycle_id_source_recorded_at_idx" ON "gps_locations"("tenant_id", "motorcycle_id", "source", "recorded_at");
