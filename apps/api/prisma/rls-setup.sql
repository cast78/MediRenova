-- Task 2.8: Row Level Security policies
-- Run this script AFTER initial seed and with a superuser connection.
-- The app sets app.tenant_id at the start of each request.

-- Enable RLS on all tenant-scoped tables
ALTER TABLE centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE revision_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Create policies (tenant isolation)
CREATE POLICY tenant_isolation_centers ON centers
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_products ON products
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_customers ON customers
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_appointments ON appointments
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_revisions ON revisions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_users ON users
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_api_keys ON api_keys
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_workflow_rules ON workflow_rules
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_audit_logs ON audit_logs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Rooms: derived from centers (center must belong to tenant)
CREATE POLICY tenant_isolation_rooms ON rooms
  USING (center_id IN (
    SELECT id FROM centers WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
  ));

-- IMPORTANT: The Prisma application user must have BYPASSRLS or the
-- policies must use a role-based check. For simplicity, superadmin
-- queries bypass RLS. The app middleware sets app.tenant_id before
-- each request via: SET LOCAL app.tenant_id = '<uuid>';
