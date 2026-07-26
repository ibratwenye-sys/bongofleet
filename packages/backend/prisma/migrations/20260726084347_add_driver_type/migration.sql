-- CreateEnum
CREATE TYPE "driver_type" AS ENUM ('RIDER', 'CAR_DRIVER', 'TRUCK_DRIVER');

-- AlterTable
ALTER TABLE "riders" ADD COLUMN     "driver_type" "driver_type" NOT NULL DEFAULT 'RIDER';
