-- CreateEnum
CREATE TYPE "password_reset_route" AS ENUM ('OWNER_DASHBOARD', 'SELF_SERVICE_CODE');

-- CreateEnum
CREATE TYPE "password_reset_channel" AS ENUM ('EMAIL', 'SMS');

-- CreateTable
CREATE TABLE "password_reset_audits" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "route" "password_reset_route" NOT NULL,
    "channel" "password_reset_channel",
    "sessions_revoked" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "password_reset_audits_tenant_id_created_at_idx" ON "password_reset_audits"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "password_reset_audits_user_id_created_at_idx" ON "password_reset_audits"("user_id", "created_at");
