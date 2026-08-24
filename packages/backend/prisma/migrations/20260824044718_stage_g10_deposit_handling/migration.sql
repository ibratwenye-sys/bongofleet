-- CreateEnum
CREATE TYPE "deposit_handling" AS ENUM ('APPLIED', 'HELD_REFUNDABLE');

-- AlterTable
ALTER TABLE "ownership_plans" ADD COLUMN     "deposit_handling" "deposit_handling" NOT NULL DEFAULT 'APPLIED',
ADD COLUMN     "deposit_returned_at" TIMESTAMP(3);
