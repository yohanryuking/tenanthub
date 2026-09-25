import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';

export interface AuditMeta {
  action: string;
  entity: string;
}

/**
 * Marks a route as audited: AuditInterceptor writes an audit_log row after
 * the handler succeeds. Pair with @UseInterceptors(AuditInterceptor) —
 * unlike TenantGuard/RolesGuard this isn't global, since only a handful of
 * routes are sensitive enough to audit.
 */
export const Audit = (action: string, entity: string) =>
  SetMetadata(AUDIT_KEY, { action, entity } satisfies AuditMeta);
