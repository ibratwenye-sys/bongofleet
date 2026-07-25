-- Permanent, never-repeating ride number on each assignment.
ALTER TABLE "daily_assignments" ADD COLUMN "reference" TEXT;
CREATE UNIQUE INDEX "daily_assignments_reference_key" ON "daily_assignments"("reference");

-- Receipt attached to a payment (deposit proof).
ALTER TABLE "daily_payments"
  ADD COLUMN "receipt_storage_key" TEXT,
  ADD COLUMN "receipt_file_name" TEXT,
  ADD COLUMN "receipt_mime_type" TEXT,
  ADD COLUMN "receipt_size_bytes" INTEGER,
  ADD COLUMN "receipt_uploaded_at" TIMESTAMP(3);
