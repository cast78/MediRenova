-- CreateTable
CREATE TABLE "short_links" (
    "code" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "short_links_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "short_links_expires_at_idx" ON "short_links"("expires_at");
