-- CreateEnum
CREATE TYPE "expense_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_user_id" TEXT,
ADD COLUMN     "daily_assignment_id" TEXT,
ADD COLUMN     "receipt_file_name" TEXT,
ADD COLUMN     "receipt_mime_type" TEXT,
ADD COLUMN     "receipt_size_bytes" INTEGER,
ADD COLUMN     "receipt_storage_key" TEXT,
ADD COLUMN     "receipt_uploaded_at" TIMESTAMP(3),
ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "status" "expense_status" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "submitted_by_rider_id" TEXT,
ADD COLUMN     "submitted_by_user_id" TEXT;
