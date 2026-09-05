-- CreateEnum
CREATE TYPE "gps_provider" AS ENUM ('TRACCAR');

-- CreateTable
CREATE TABLE "gps_provider_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" "gps_provider" NOT NULL DEFAULT 'TRACCAR',
    "base_url" TEXT NOT NULL,
    "credentials_encrypted" BYTEA NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_polled_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gps_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gps_provider_configs_tenant_id_provider_key" ON "gps_provider_configs"("tenant_id", "provider");

-- AddForeignKey
ALTER TABLE "gps_provider_configs" ADD CONSTRAINT "gps_provider_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
