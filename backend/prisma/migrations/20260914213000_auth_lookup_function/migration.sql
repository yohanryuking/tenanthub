-- Narrow, explicit escape hatch for the one place the app legitimately
-- needs a cross-tenant read: login, which has to find "does this email +
-- organization slug combination exist" *before* any tenant context can be
-- set (you can't scope a query to app.current_org when the whole point of
-- the query is to discover what that org is).
--
-- Rather than giving the app role a general RLS bypass (which would defeat
-- the entire point of this migration), this function is SECURITY DEFINER
-- (runs with the privileges of the owner that created it, which bypasses
-- RLS) but only ever returns the single row matching the exact
-- (email, org_slug) pair passed in — never a listing, never "all orgs for
-- this user". Ownership stays with the migration/owner role; tenanthub_app
-- is only granted EXECUTE, not table-level bypass.
CREATE FUNCTION auth_login_lookup(p_email text, p_org_slug text)
RETURNS TABLE (
  user_id uuid,
  password_hash text,
  org_id uuid,
  org_slug text,
  role "MembershipRole"
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.password_hash, o.id, o.slug, m.role
  FROM users u
  JOIN memberships m ON m.user_id = u.id
  JOIN organizations o ON o.id = m.org_id
  WHERE u.email = p_email
    AND o.slug = p_org_slug;
$$;

REVOKE ALL ON FUNCTION auth_login_lookup(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_login_lookup(text, text) TO tenanthub_app;

-- Companion lookup used by the (future, Sprint 2) "which of my orgs can I
-- log into" screen — same narrowing principle, scoped to one email.
CREATE FUNCTION auth_list_orgs_for_email(p_email text)
RETURNS TABLE (org_id uuid, org_slug text, org_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.slug, o.name
  FROM users u
  JOIN memberships m ON m.user_id = u.id
  JOIN organizations o ON o.id = m.org_id
  WHERE u.email = p_email;
$$;

REVOKE ALL ON FUNCTION auth_list_orgs_for_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_list_orgs_for_email(text) TO tenanthub_app;
