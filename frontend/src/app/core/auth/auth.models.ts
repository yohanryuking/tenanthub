export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface OrgOption {
  org_id: string;
  org_slug: string;
  org_name: string;
}

export interface AccessTokenClaims {
  sub: string;
  orgId: string;
  role: 'admin' | 'member';
  iat: number;
  exp: number;
}
