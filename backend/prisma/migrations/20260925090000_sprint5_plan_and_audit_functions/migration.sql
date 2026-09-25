-- Sprint 5: plan gating needs the org's plan available wherever a JWT is
-- issued (login, register, accept-invitation, refresh) — the token is
-- scoped to an org already, so its plan can travel alongside orgId/role
-- exactly the same way. Like role (Sprint 4), plan is a snapshot: a plan
-- change becomes visible to a session on its next refresh/login, not
-- instantly. See docs/architecture.md.
--
-- Every function below already existed; each is dropped and recreated
-- only to add one output column (org plan), same mechanical reason as
-- the Sprint 2 ambiguity fix — Postgres doesn't allow CREATE OR REPLACE
-- to change a function's output row shape.

DROP FUNCTION auth_login_lookup(text, text);

CREATE FUNCTION auth_login_lookup(p_email text, p_org_slug text)
RETURNS TABLE (
  user_id uuid,
  password_hash text,
  org_id uuid,
  org_slug text,
  role "MembershipRole",
  org_plan "Plan"
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.password_hash, o.id, o.slug, m.role, o.plan
  FROM users u
  JOIN memberships m ON m.user_id = u.id
  JOIN organizations o ON o.id = m.org_id
  WHERE u.email = p_email
    AND o.slug = p_org_slug;
$$;

REVOKE ALL ON FUNCTION auth_login_lookup(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_login_lookup(text, text) TO tenanthub_app;

DROP FUNCTION auth_register(text, text, text, text);

CREATE FUNCTION auth_register(
  p_org_name text,
  p_org_slug text,
  p_email text,
  p_password_hash text
)
RETURNS TABLE (user_id uuid, org_id uuid, role "MembershipRole", org_plan "Plan")
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_plan "Plan";
BEGIN
  INSERT INTO organizations (id, name, slug, updated_at)
  VALUES (gen_random_uuid(), p_org_name, p_org_slug, now())
  RETURNING id, plan INTO v_org_id, v_plan;

  INSERT INTO users (id, email, password_hash, updated_at)
  VALUES (gen_random_uuid(), p_email, p_password_hash, now())
  RETURNING id INTO v_user_id;

  INSERT INTO memberships (id, org_id, user_id, role)
  VALUES (gen_random_uuid(), v_org_id, v_user_id, 'admin');

  RETURN QUERY SELECT v_user_id, v_org_id, 'admin'::"MembershipRole", v_plan;
END;
$$;

REVOKE ALL ON FUNCTION auth_register(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_register(text, text, text, text) TO tenanthub_app;

DROP FUNCTION auth_accept_invitation(text, uuid);

CREATE FUNCTION auth_accept_invitation(p_token_hash text, p_user_id uuid)
RETURNS TABLE (out_org_id uuid, out_role "MembershipRole", out_plan "Plan")
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation invitations%ROWTYPE;
  v_plan "Plan";
BEGIN
  SELECT * INTO v_invitation
  FROM invitations
  WHERE token_hash = p_token_hash
    AND accepted_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT plan INTO v_plan FROM organizations WHERE id = v_invitation.org_id;

  INSERT INTO memberships (id, org_id, user_id, role)
  VALUES (gen_random_uuid(), v_invitation.org_id, p_user_id, v_invitation.role)
  ON CONFLICT (org_id, user_id) DO NOTHING;

  UPDATE invitations SET accepted_at = now() WHERE id = v_invitation.id;

  RETURN QUERY SELECT v_invitation.org_id, v_invitation.role, v_plan;
END;
$$;

REVOKE ALL ON FUNCTION auth_accept_invitation(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_accept_invitation(text, uuid) TO tenanthub_app;

DROP FUNCTION auth_consume_refresh_token(text);

CREATE FUNCTION auth_consume_refresh_token(p_token_hash text)
RETURNS TABLE (user_id uuid, org_id uuid, role "MembershipRole", plan "Plan")
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
    SELECT m.user_id, m.org_id, m.role, o.plan
    FROM memberships m
    JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = v_token.user_id AND m.org_id = v_token.org_id;
END;
$$;

REVOKE ALL ON FUNCTION auth_consume_refresh_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_consume_refresh_token(text) TO tenanthub_app;

-- Audit log: the one write that legitimately needs to cross the tenant
-- boundary is logging in, which (like login itself) happens before any
-- tenant context exists. Every other audited action (invite created,
-- role changed, plan changed, task deleted) already runs inside the
-- caller's tenant-scoped transaction and writes to audit_log through the
-- normal RLS-checked path — no function needed there.
CREATE FUNCTION audit_write_cross_tenant(
  p_org_id uuid,
  p_actor_id uuid,
  p_action text,
  p_entity text,
  p_entity_id uuid,
  p_metadata jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO audit_log (id, org_id, actor_id, action, entity, entity_id, metadata)
  VALUES (gen_random_uuid(), p_org_id, p_actor_id, p_action, p_entity, p_entity_id, p_metadata);
$$;

REVOKE ALL ON FUNCTION audit_write_cross_tenant(uuid, uuid, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_write_cross_tenant(uuid, uuid, text, text, uuid, jsonb) TO tenanthub_app;
