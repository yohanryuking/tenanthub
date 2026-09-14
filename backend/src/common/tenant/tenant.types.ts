export type MembershipRole = 'admin' | 'member';

/**
 * What a verified JWT tells us about the caller. `orgId` is the tenant the
 * *token* was scoped to at login time — it is decoded from a signed token,
 * never read from a request body/query, so a client cannot claim to be in a
 * different organization by editing a payload.
 */
export interface TenantClaims {
  userId: string;
  orgId: string;
  role: MembershipRole;
}

declare module 'express' {
  interface Request {
    tenant?: TenantClaims;
  }
}
