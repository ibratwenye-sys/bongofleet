-- CreateEnum
CREATE TYPE "document_owner_type" AS ENUM ('RIDER', 'MOTORCYCLE', 'GUARANTOR');

-- CreateEnum
CREATE TYPE "document_type" AS ENUM ('NATIONAL_ID', 'DRIVERS_LICENSE', 'LATRA', 'INSURANCE', 'REGISTRATION_CARD', 'GUARANTOR_ID', 'OTHER');

-- CreateTable
CREATE TABLE "guarantors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "rider_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "relationship" TEXT,
    "national_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guarantors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "owner_type" "document_owner_type" NOT NULL,
    "owner_id" TEXT NOT NULL,
    "doc_type" "document_type" NOT NULL,
    "reference_number" TEXT,
    "expiry_date" DATE,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guarantors_tenant_id_idx" ON "guarantors"("tenant_id");

-- CreateIndex
CREATE INDEX "guarantors_rider_id_idx" ON "guarantors"("rider_id");

-- CreateIndex
CREATE INDEX "documents_tenant_id_idx" ON "documents"("tenant_id");

-- CreateIndex
CREATE INDEX "documents_owner_type_owner_id_idx" ON "documents"("owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "documents_tenant_id_expiry_date_idx" ON "documents"("tenant_id", "expiry_date");

-- AddForeignKey
ALTER TABLE "guarantors" ADD CONSTRAINT "guarantors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guarantors" ADD CONSTRAINT "guarantors_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
