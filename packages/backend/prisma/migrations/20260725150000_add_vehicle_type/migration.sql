-- Vehicle categories: motorbikes/bajaji run the daily-rental model; cars/trucks
-- will be monitored as transport jobs. Existing rows are motorbikes.
CREATE TYPE "VehicleType" AS ENUM ('MOTORBIKE', 'BAJAJI', 'CAR', 'TRUCK');
ALTER TABLE "motorcycles" ADD COLUMN "vehicle_type" "VehicleType" NOT NULL DEFAULT 'MOTORBIKE';
