-- AlterTable
ALTER TABLE "transport_jobs" ADD COLUMN     "delivery_photo_file_name" TEXT,
ADD COLUMN     "delivery_photo_mime_type" TEXT,
ADD COLUMN     "delivery_photo_size_bytes" INTEGER,
ADD COLUMN     "delivery_photo_storage_key" TEXT,
ADD COLUMN     "delivery_photo_uploaded_at" TIMESTAMP(3);
