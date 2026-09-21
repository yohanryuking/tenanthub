-- Sprint 2: registration, invitations, refresh tokens.
--
-- Same pattern as the Sprint 1 auth_login_lookup functions (see
-- 20260914213000_auth_lookup_function/migration.sql): RLS stays
-- deny-by-default for tenanthub_app, and the handful of operations that
-- legitimately need to cross the tenant boundary (you can't have a tenant
-- context for an org that doesn't exist yet, or for one you're not a
-- member of until your invitation is accepted) go through narrow
-- SECURITY DEFINER functions instead of a general RLS bypass.

-- 1. RLS on the two new tables --------------------------------------------

ALTER TABLE invitations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

-- invitations: an authenticated admin creates these through the normal
-- tenant-scoped Prisma client (they already have an org context), so the
-- regular policy is enough for that path.
CREATE POLICY tenant_isolation_invitations ON invitations
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- refresh_tokens: never queried through the tenant-scoped client at all
-- (see auth_consume_refresh_token below) — RLS is enabled anyway so that
-- stays true even if something changes later, rather than relying on
-- "nobody happens to query this table directly" as the safeguard.
CREATE POLICY tenant_isolation_refresh_tokens ON refresh_tokens
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- 2. Registration: create org + user + admin membership atomically -------
CREATE FUNCTION auth_register(
  p_org_name text,
  p_org_slug text,
  p_email text,
  p_password_hash text
)
RETURNS TABLE (user_id uuid, org_id uuid, role "MembershipRole")
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
BEGIN
  INSERT INTO organizations (id, name, slug, updated_at)
  VALUES (gen_random_uuid(), p_org_name, p_org_slug, now())
  RETURNING id INTO v_org_id;

  INSERT INTO users (id, email, password_hash, updated_at)
  VALUES (gen_random_uuid(), p_email, p_password_hash, now())
  RETURNING id INTO v_user_id;

  INSERT INTO memberships (id, org_id, user_id, role)
  VALUES (gen_random_uuid(), v_org_id, v_user_id, 'admin');

  RETURN QUERY SELECT v_user_id, v_org_id, 'admin'::"MembershipRole";
END;
$$;

REVOKE ALL ON FUNCTION auth_register(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_register(text, text, text, text) TO tenanthub_app;

-- 3. Invitations: accepting one creates a membership in an org the
--    acceptor has no session for yet. ------------------------------------
CREATE FUNCTION auth_accept_invitation(p_token_hash text, p_user_id uuid)
RETURNS TABLE (org_id uuid, role "MembershipRole")
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation invitations%ROWTYPE;
BEGIN
  SELECT * INTO v_invitation
  FROM invitations
  WHERE token_hash = p_token_hash
    AND accepted_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO memberships (id, org_id, user_id, role)
  VALUES (gen_random_uuid(), v_invitation.org_id, p_user_id, v_invitation.role)
  ON CONFLICT (org_id, user_id) DO NOTHING;

  UPDATE invitations SET accepted_at = now() WHERE id = v_invitation.id;

  RETURN QUERY SELECT v_invitation.org_id, v_invitation.role;
END;
$$;

REVOKE ALL ON FUNCTION auth_accept_invitation(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_accept_invitation(text, uuid) TO tenanthub_app;

-- 4. Refresh tokens: issue, consume-and-rotate, revoke --------------------
CREATE FUNCTION auth_issue_refresh_token(
  p_user_id uuid,
  p_org_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO refresh_tokens (id, user_id, org_id, token_hash, expires_at)
  VALUES (gen_random_uuid(), p_user_id, p_org_id, p_token_hash, p_expires_at);
$$;

REVOKE ALL ON FUNCTION auth_issue_refresh_token(uuid, uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_issue_refresh_token(uuid, uuid, text, timestamptz) TO tenanthub_app;

-- Consuming a refresh token immediately revokes it (rotation): a token can
-- only ever be exchanged once. The caller is responsible for issuing a new
-- one via auth_issue_refresh_token right after a successful consume — if it
-- doesn't, the session simply ends, which is the safe failure mode.
CREATE FUNCTION auth_consume_refresh_token(p_token_hash text)
RETURNS TABLE (user_id uuid, org_id uuid, role "MembershipRole")
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token refresh_tokens%ROWTYPE;
BEGIN
  SELECT * INTO v_token
  FROM refresh_tokens
  WHERE token_hash = p_token_hash
    AND revoked_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE refresh_tokens SET revoked_at = now() WHERE id = v_token.id;

  RETURN QUERY
    SELECT m.user_id, m.org_id, m.role
    FROM memberships m
    WHERE m.user_id = v_token.user_id AND m.org_id = v_token.org_id;
END;
$$;

REVOKE ALL ON FUNCTION auth_consume_refresh_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_consume_refresh_token(text) TO tenanthub_app;

CREATE FUNCTION auth_revoke_refresh_token(p_token_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE refresh_tokens SET revoked_at = now()
  WHERE token_hash = p_token_hash AND revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION auth_revoke_refresh_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_revoke_refresh_token(text) TO tenanthub_app;
