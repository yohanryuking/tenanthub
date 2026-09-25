import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, concatMap, from } from 'rxjs';
import { AuditLogService } from './audit-log.service';
import { AUDIT_KEY, AuditMeta } from './audit.decorator';

/**
 * Applied per-route (never global) alongside @Audit(action, entity).
 * Runs nested inside the global TenantInterceptor's transaction, and the
 * write below is *awaited* as part of the response stream (concatMap, not
 * tap) rather than fired and forgotten — tap's callback isn't awaited by
 * rxjs, so an un-awaited write here could still be in flight when
 * TenantInterceptor's $transaction callback resolves and Postgres commits,
 * silently losing the audit row. Awaiting it here means the write commits
 * atomically with the action it's auditing, or the whole request fails.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditLog: AuditLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta | undefined>(AUDIT_KEY, context.getHandler());
    const request = context.switchToHttp().getRequest<Request>();

    if (!meta || !request.tenant) {
      // Misconfiguration (decorator without the interceptor's usual
      // pairing, or applied to a public route). Audit gaps shouldn't take
      // down the actual feature the way a missing tenant context does —
      // that's a deliberate difference from TenantContextService's
      // fail-loud rule, logged instead so it's visible without being
      // fatal.
      this.logger.warn(
        `AuditInterceptor applied without @Audit metadata or tenant context on ${request.method} ${request.url}`,
      );
      return next.handle();
    }

    return next.handle().pipe(
      concatMap((result: unknown) =>
        from(
          (async () => {
            const entityId =
              request.params?.id ?? (result as { id?: string } | undefined)?.id ?? null;
            await this.auditLog.write(
              request.tenant!,
              meta.action,
              meta.entity,
              entityId,
              request.body,
            );
            return result;
          })(),
        ),
      ),
    );
  }
}
