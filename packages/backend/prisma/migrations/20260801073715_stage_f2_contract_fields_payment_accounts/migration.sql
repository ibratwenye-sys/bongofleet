-- CreateEnum
CREATE TYPE "payment_account_kind" AS ENUM ('BANK', 'LIPA_NUMBER', 'MOBILE_MONEY');

-- AlterTable
ALTER TABLE "daily_payments" ADD COLUMN     "payment_account_id" TEXT;

-- AlterTable
ALTER TABLE "guarantors" ADD COLUMN     "residence_district" TEXT,
ADD COLUMN     "residence_region" TEXT,
ADD COLUMN     "residence_ward" TEXT;

-- AlterTable
ALTER TABLE "motorcycles" ADD COLUMN     "chassis_number" TEXT,
ADD COLUMN     "colour" TEXT;

-- AlterTable
ALTER TABLE "ownership_plans" ADD COLUMN     "breach_after_consecutive_missed_days" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "late_fee_amount" DECIMAL(10,2),
ADD COLUMN     "name_transfer_confirmed_at" TIMESTAMP(3),
ADD COLUMN     "registration_card_handed_over_at" TIMESTAMP(3),
ADD COLUMN     "spare_key_handed_over_at" TIMESTAMP(3),
ALTER COLUMN "active_weekdays" SET DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[];

-- AlterTable
ALTER TABLE "riders" ADD COLUMN     "residence_district" TEXT,
ADD COLUMN     "residence_region" TEXT,
ADD COLUMN     "residence_ward" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "director_name" TEXT,
ADD COLUMN     "physical_address" TEXT;

-- CreateTable
CREATE TABLE "payment_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" "payment_account_kind" NOT NULL,
    "provider" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_accounts_tenant_id_is_active_sort_order_idx" ON "payment_accounts"("tenant_id", "is_active", "sort_order");

-- CreateIndex
CREATE INDEX "daily_payments_payment_account_id_idx" ON "daily_payments"("payment_account_id");

-- AddForeignKey
ALTER TABLE "daily_payments" ADD CONSTRAINT "daily_payments_payment_account_id_fkey" FOREIGN KEY ("payment_account_id") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
