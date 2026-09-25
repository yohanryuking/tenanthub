export type MembershipRole = 'admin' | 'member';
export type Plan = 'free' | 'pro';

/**
 * What a verified JWT tells us about the caller. `orgId` is the tenant the
 * *token* was scoped to at login time — it is decoded from a signed token,
 * never read from a request body/query, so a client cannot claim to be in a
 * different organization by editing a payload.
 *
 * `role` and `plan` are both snapshots taken when the token was issued —
 * see docs/architecture.md for why a role or plan change only takes
 * effect for a given session on its next refresh/login, not instantly.
 */
export interface TenantClaims {
  userId: string;
  orgId: string;
  role: MembershipRole;
  plan: Plan;
}

declare module 'express' {
  interface Request {
    tenant?: TenantClaims;
  }
}
