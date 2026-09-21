import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { from, Observable } from 'rxjs';
import { lastValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from './tenant-context.service';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Global interceptor: for every non-public request, opens one Postgres
 * transaction, sets `app.current_org` on it via `set_config(..., true)`
 * (transaction-local — equivalent to SET LOCAL), and runs the rest of the
 * request (controller + service + all Prisma calls made through
 * TenantContextService.getClient()) inside that same transaction.
 *
 * This is what makes the RLS policies bite: every query the handler issues
 * goes through a connection that has already declared which org it is
 * allowed to see, and that declaration cannot outlive the transaction or
 * leak to another concurrent request.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const orgId = request.tenant?.orgId;
    if (!orgId) {
      // TenantGuard runs first and would already have thrown; this is a
      // defense-in-depth check in case ordering ever changes.
      throw new Error('TenantInterceptor ran without a resolved tenant');
    }

    return from(
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_org', ${orgId}, true)`;
        return this.tenantContext.runWithClient(tx, () =>
          lastValueFrom(next.handle()),
        );
      }),
    );
  }
}
