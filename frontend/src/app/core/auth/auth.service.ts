import { HttpClient } from '@angular/common/http';
import { Injectable, computed, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AccessTokenClaims, OrgOption, TokenPair } from './auth.models';

const ACCESS_TOKEN_KEY = 'th_access_token';
const REFRESH_TOKEN_KEY = 'th_refresh_token';

/**
 * Tokens live in localStorage for this phase — simplest thing that works
 * for a demo, but it means any XSS on this app can steal them. A
 * production hardening pass would move the refresh token to an httpOnly
 * cookie set by the backend; noted as a follow-up, not solved here (see
 * docs/threat-model.md).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly accessTokenSignal = signal<string | null>(
    localStorage.getItem(ACCESS_TOKEN_KEY),
  );

  readonly isAuthenticated = computed(() => this.accessTokenSignal() !== null);

  readonly claims = computed<AccessTokenClaims | null>(() => {
    const token = this.accessTokenSignal();
    return token ? decodeJwtPayload(token) : null;
  });

  constructor(private readonly http: HttpClient) {}

  register(orgName: string, orgSlug: string, email: string, password: string) {
    return this.http
      .post<TokenPair>(`${environment.apiUrl}/auth/register`, {
        orgName,
        orgSlug,
        email,
        password,
      })
      .pipe(tap((tokens) => this.storeTokens(tokens)));
  }

  login(orgSlug: string, email: string, password: string) {
    return this.http
      .post<TokenPair>(`${environment.apiUrl}/auth/login`, { orgSlug, email, password })
      .pipe(tap((tokens) => this.storeTokens(tokens)));
  }

  listOrgs(email: string): Observable<OrgOption[]> {
    return this.http.get<OrgOption[]>(`${environment.apiUrl}/auth/orgs`, {
      params: { email },
    });
  }

  acceptInvitation(token: string, password?: string) {
    return this.http
      .post<TokenPair>(`${environment.apiUrl}/auth/invitations/${token}/accept`, {
        password,
      })
      .pipe(tap((tokens) => this.storeTokens(tokens)));
  }

  refresh(): Observable<TokenPair> {
    const refreshToken = this.getRefreshToken();
    return this.http
      .post<TokenPair>(`${environment.apiUrl}/auth/refresh`, { refreshToken })
      .pipe(tap((tokens) => this.storeTokens(tokens)));
  }

  logout() {
    const refreshToken = this.getRefreshToken();
    this.clearTokens();
    if (!refreshToken) return;
    // Best-effort: the tokens are already gone client-side regardless of
    // whether the server call succeeds.
    this.http
      .post(`${environment.apiUrl}/auth/logout`, { refreshToken })
      .subscribe({ error: () => undefined });
  }

  getAccessToken(): string | null {
    return this.accessTokenSignal();
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  }

  private storeTokens(tokens: TokenPair) {
    localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    this.accessTokenSignal.set(tokens.accessToken);
  }

  private clearTokens() {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    this.accessTokenSignal.set(null);
  }
}

function decodeJwtPayload(token: string): AccessTokenClaims | null {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}
