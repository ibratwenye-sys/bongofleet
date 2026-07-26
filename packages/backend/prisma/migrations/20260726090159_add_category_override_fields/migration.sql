-- AlterTable
ALTER TABLE "daily_assignments" ADD COLUMN     "category_override_at" TIMESTAMP(3),
ADD COLUMN     "category_override_by_user_id" TEXT,
ADD COLUMN     "category_override_reason" TEXT;

-- AlterTable
ALTER TABLE "transport_jobs" ADD COLUMN     "category_override_at" TIMESTAMP(3),
ADD COLUMN     "category_override_by_user_id" TEXT,
ADD COLUMN     "category_override_reason" TEXT;
