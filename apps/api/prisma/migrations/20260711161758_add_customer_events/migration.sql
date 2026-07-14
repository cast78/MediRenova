-- CreateTable
CREATE TABLE "customer_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "appointment_id" TEXT,
    "type" TEXT NOT NULL,
    "channel" TEXT,
    "actor" TEXT,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_events_tenant_id_customer_id_idx" ON "customer_events"("tenant_id", "customer_id");

