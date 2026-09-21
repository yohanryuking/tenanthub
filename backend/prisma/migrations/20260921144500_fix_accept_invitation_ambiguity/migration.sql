-- auth_accept_invitation's RETURNS TABLE(org_id, role) declared implicit
-- PL/pgSQL OUT variables named org_id/role. Postgres's plpgsql query
-- scanner treats the ON CONFLICT (org_id, user_id) conflict target as an
-- expression position and flags "org_id" as ambiguous between that
-- variable and the memberships.org_id column — a real bug, not RLS-related
-- (discovered by actually exercising the accept-invitation flow end to
-- end, not just testing register/login in isolation).
--
-- Fix: rename the OUT parameters so nothing in the function body can
-- collide with a real column name, and alias them back at the call site
-- (see AuthService.acceptInvitation).
DROP FUNCTION auth_accept_invitation(text, uuid);

CREATE FUNCTION auth_accept_invitation(p_token_hash text, p_user_id uuid)
RETURNS TABLE (out_org_id uuid, out_role "MembershipRole")
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
