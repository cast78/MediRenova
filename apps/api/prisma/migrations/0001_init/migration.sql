-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPERADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST');
CREATE TYPE "ProductType" AS ENUM ('CARNET_CONDUCIR', 'LICENCIA_ARMAS', 'DNI', 'OTRO');
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW');
CREATE TYPE "AppointmentSource" AS ENUM ('BACKOFFICE', 'MAGIC_LINK', 'API', 'WALK_IN');
CREATE TYPE "RevisionOutcome" AS ENUM ('PENDING', 'APTO', 'NO_APTO');
CREATE TYPE "WorkflowAction" AS ENUM ('WHATSAPP');
CREATE TYPE "WorkflowExecutionStatus" AS ENUM ('PENDING_SEND', 'SENT', 'FAILED', 'EXHAUSTED', 'COMPLETED');
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateTable: tenants
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateTable: tenant_configs
CREATE TABLE "tenant_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "logo_url" TEXT,
    "primary_color" TEXT NOT NULL DEFAULT '#2563eb',
    "secondary_color" TEXT NOT NULL DEFAULT '#64748b',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Madrid',
    "default_slot_duration" INTEGER NOT NULL DEFAULT 20,
    "max_appointments_per_day" INTEGER,
    "meta_wa_phone_number_id" TEXT,
    "meta_wa_access_token" TEXT,
    CONSTRAINT "tenant_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenant_configs_tenant_id_key" ON "tenant_configs"("tenant_id");

-- CreateTable: users
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateTable: user_sessions
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "revoked_at" TIMESTAMPTZ,
    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_sessions_refresh_token_key" ON "user_sessions"("refresh_token");
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateTable: api_keys
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "revoked_at" TIMESTAMPTZ,
    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");
CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys"("tenant_id");

-- CreateTable: centers
CREATE TABLE "centers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "holidays" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "centers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "centers_tenant_id_idx" ON "centers"("tenant_id");

-- CreateTable: rooms
CREATE TABLE "rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "center_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "allowed_product_types" JSONB NOT NULL DEFAULT '[]',
    "schedule" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rooms_center_id_idx" ON "rooms"("center_id");

-- CreateTable: room_doctors
CREATE TABLE "room_doctors" (
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    CONSTRAINT "room_doctors_pkey" PRIMARY KEY ("room_id", "user_id")
);

-- CreateTable: products
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ProductType" NOT NULL,
    "slot_duration" INTEGER NOT NULL,
    "renewal_rules" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "products_tenant_id_idx" ON "products"("tenant_id");

-- CreateTable: form_templates
CREATE TABLE "form_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "schema" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "based_on_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "form_templates_product_id_version_key" ON "form_templates"("product_id", "version");
CREATE INDEX "form_templates_product_id_idx" ON "form_templates"("product_id");

-- CreateTable: customers
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "dni_encrypted" TEXT,
    "dni_hash" TEXT,
    "birth_date" TIMESTAMPTZ,
    "nationality" TEXT,
    "municipality" TEXT,
    "province" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gdpr_consent_at" TIMESTAMPTZ,
    "gdpr_consent_ip" TEXT,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customers_tenant_id_dni_hash_key" ON "customers"("tenant_id", "dni_hash");
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");
CREATE INDEX "customers_tenant_id_deleted_at_idx" ON "customers"("tenant_id", "deleted_at");

-- CreateTable: appointments
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "doctor_id" UUID,
    "scheduled_at" TIMESTAMPTZ NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING',
    "source" "AppointmentSource" NOT NULL DEFAULT 'BACKOFFICE',
    "notes" TEXT,
    "ics_url" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "appointments_tenant_id_idx" ON "appointments"("tenant_id");
CREATE INDEX "appointments_tenant_id_scheduled_at_idx" ON "appointments"("tenant_id", "scheduled_at");
CREATE INDEX "appointments_tenant_id_status_idx" ON "appointments"("tenant_id", "status");
CREATE INDEX "appointments_room_id_scheduled_at_idx" ON "appointments"("room_id", "scheduled_at");

-- Task 2.6: Unique conditional index for double-booking protection
CREATE UNIQUE INDEX "appointments_room_id_scheduled_at_active_key"
  ON "appointments"("room_id", "scheduled_at")
  WHERE status NOT IN ('CANCELLED', 'NO_SHOW');

-- CreateTable: revisions
CREATE TABLE "revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "form_template_id" UUID NOT NULL,
    "form_data" JSONB NOT NULL DEFAULT '{}',
    "outcome" "RevisionOutcome" NOT NULL DEFAULT 'PENDING',
    "expiry_date" TIMESTAMPTZ,
    "pdf_url" TEXT,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "revisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "revisions_appointment_id_key" ON "revisions"("appointment_id");
CREATE INDEX "revisions_tenant_id_idx" ON "revisions"("tenant_id");
CREATE INDEX "revisions_tenant_id_customer_id_idx" ON "revisions"("tenant_id", "customer_id");
CREATE INDEX "revisions_tenant_id_outcome_expiry_idx" ON "revisions"("tenant_id", "outcome", "expiry_date");

-- CreateTable: revision_attachments
CREATE TABLE "revision_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revision_id" UUID NOT NULL,
    "field_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "r2_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "revision_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "revision_attachments_revision_id_idx" ON "revision_attachments"("revision_id");

-- CreateTable: workflow_rules
CREATE TABLE "workflow_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "days_before_expiry" INTEGER NOT NULL,
    "action_type" "WorkflowAction" NOT NULL,
    "template_name" TEXT NOT NULL,
    "retry_every_days" INTEGER NOT NULL DEFAULT 15,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "workflow_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "workflow_rules_tenant_id_idx" ON "workflow_rules"("tenant_id");

-- CreateTable: workflow_executions
CREATE TABLE "workflow_executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rule_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "status" "WorkflowExecutionStatus" NOT NULL DEFAULT 'PENDING_SEND',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ,
    "next_attempt_at" TIMESTAMPTZ,
    "magic_link_token" TEXT,
    "result" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "workflow_executions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "workflow_executions_rule_id_idx" ON "workflow_executions"("rule_id");
CREATE INDEX "workflow_executions_customer_id_idx" ON "workflow_executions"("customer_id");
CREATE INDEX "workflow_executions_status_next_attempt_idx" ON "workflow_executions"("status", "next_attempt_at");

-- CreateTable: audit_logs
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "action" "AuditAction" NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "ip_address" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");
CREATE INDEX "audit_logs_tenant_id_resource_idx" ON "audit_logs"("tenant_id", "resource_type", "resource_id");

-- Task 2.8: Row Level Security (enable after seeding)
-- Run these after initial seed:
-- ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE centers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
-- ... (see rls-setup.sql)

-- AddForeignKeys
ALTER TABLE "tenant_configs" ADD CONSTRAINT "tenant_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "centers" ADD CONSTRAINT "centers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_doctors" ADD CONSTRAINT "room_doctors_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_doctors" ADD CONSTRAINT "room_doctors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON UPDATE CASCADE;
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON UPDATE CASCADE;
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON UPDATE CASCADE;
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON UPDATE CASCADE;
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_form_template_id_fkey" FOREIGN KEY ("form_template_id") REFERENCES "form_templates"("id") ON UPDATE CASCADE;
ALTER TABLE "revision_attachments" ADD CONSTRAINT "revision_attachments_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON UPDATE CASCADE;
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "workflow_rules"("id") ON UPDATE CASCADE;
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON UPDATE CASCADE;
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "revisions"("id") ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE CASCADE;
