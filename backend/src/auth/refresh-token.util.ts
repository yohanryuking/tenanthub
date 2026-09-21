import { randomBytes, createHash } from 'node:crypto';

/**
 * Refresh tokens are opaque random strings, never JWTs — there's nothing to
 * decode, so the only way to use one is to present it back to the server,
 * which looks it up by its hash. Only the hash is ever stored; the raw
 * token exists solely in the response body and the client's storage.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
