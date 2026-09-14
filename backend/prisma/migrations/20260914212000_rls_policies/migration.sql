-- Row-Level Security: the real tenant boundary.
--
-- Everything above this migration only describes table shape. This is the
-- migration that actually isolates tenants: it runs entirely inside
-- PostgreSQL, so the guarantee holds even if a future NestJS endpoint
-- forgets a WHERE org_id = ... clause.
--
-- Model:
--   * `tenanthub_app` is a non-superuser, non-owner login role. The backend
--     connects as this role at runtime (APP_DATABASE_URL). RLS is NEVER
--     bypassed by a non-owner role, so no FORCE ROW LEVEL SECURITY dance is
--     needed — this is the simplest correct setup.
--   * Migrations run as the table owner (DATABASE_URL, typically the
--     `postgres` superuser locally). Superusers and owners bypass RLS by
--     design, which is exactly why the app must never connect as either.
--   * `app.current_org` is a per-transaction session variable
--     (`set_config('app.current_org', <uuid>, true)` — the `true` makes it
--     transaction-local, i.e. equivalent to SET LOCAL). The backend sets it
--     once per request inside a transaction, derived from the verified JWT,
--     never from the request body. See src/common/tenant/tenant.interceptor.ts.
--   * Deny-by-default: policies use USING/WITH CHECK against
--     current_setting(..., true), which returns NULL when unset. NULL
--     compared to any org_id is never true, so a connection that never set
--     the tenant context sees and can write to nothing.

-- 1. Runtime application role -------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenanthub_app') THEN
    CREATE ROLE tenanthub_app LOGIN PASSWORD 'tenanthub_app';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO tenanthub_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tenanthub_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tenanthub_app;

-- memberships and audit_log rows are never deleted by the app; revoke DELETE
-- there specifically so a compromised app role can't erase history.
REVOKE DELETE ON audit_log FROM tenanthub_app;

-- 2. Enable RLS on every tenant-scoped table ----------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log     ENABLE ROW LEVEL SECURITY;

-- 3. Policies ------------------------------------------------------------------

-- organizations: a connection may see/touch only the org it is scoped to.
CREATE POLICY tenant_isolation_organizations ON organizations
  USING (id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (id = current_setting('app.current_org', true)::uuid);

-- memberships: scoped by org_id like every other tenant table. Membership
-- rows are how a user proves they belong to an org in the first place, so
-- this table is what Sprint 2's auth flow will query to mint a JWT — but
-- that query still runs through the same RLS boundary, scoped per org.
CREATE POLICY tenant_isolation_memberships ON memberships
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- tasks: the sample business domain.
CREATE POLICY tenant_isolation_tasks ON tasks
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- audit_log: isolated the same way; INSERT-only from the app (DELETE
-- revoked above), append-only history per tenant.
CREATE POLICY tenant_isolation_audit_log ON audit_log
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- Note: `users` is intentionally NOT org-scoped or RLS-protected. A user can
-- belong to several organizations (see `memberships`), so the users table
-- itself is not tenant data — only which memberships/tasks/audit rows a
-- session can see are. Authentication (Sprint 2) looks users up by email
-- before any tenant context exists, using the app role directly.
