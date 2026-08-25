-- CreateTable
CREATE TABLE "tracking_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "motorcycle_id" TEXT,
    "token" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracking_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tracking_links_token_key" ON "tracking_links"("token");

-- CreateIndex
CREATE INDEX "tracking_links_tenant_id_idx" ON "tracking_links"("tenant_id");

-- AddForeignKey
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_motorcycle_id_fkey" FOREIGN KEY ("motorcycle_id") REFERENCES "motorcycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
