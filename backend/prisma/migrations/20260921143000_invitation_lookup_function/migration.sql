-- Read-only companion to auth_accept_invitation: lets the backend show the
-- invited email/org and decide "does this person need to set a password
-- (new user) or just log in (existing user)" before actually accepting.
-- Same SECURITY DEFINER pattern as every other cross-tenant auth lookup —
-- narrowed to the exact token hash passed in.
CREATE FUNCTION auth_invitation_lookup(p_token_hash text)
RETURNS TABLE (
  org_id      uuid,
  org_name    text,
  email       text,
  role        "MembershipRole",
  expires_at  timestamp,
  accepted_at timestamp
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.name, i.email, i.role, i.expires_at, i.accepted_at
  FROM invitations i
  JOIN organizations o ON o.id = i.org_id
  WHERE i.token_hash = p_token_hash;
$$;

REVOKE ALL ON FUNCTION auth_invitation_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_invitation_lookup(text) TO tenanthub_app;
