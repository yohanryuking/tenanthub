import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';

type TenantScopedClient = Prisma.TransactionClient;

/**
 * Holds, per async execution context (i.e. per in-flight request), the
 * Prisma transaction client that already had `app.current_org` set via
 * `SELECT set_config(...)` for this request. Because it's transaction-local
 * (AsyncLocalStorage + Postgres SET LOCAL semantics), concurrent requests
 * for different organizations never see each other's setting — there is no
 * shared mutable "current org" anywhere in the process.
 */
@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantScopedClient>();

  runWithClient<T>(client: TenantScopedClient, fn: () => Promise<T>): Promise<T> {
    return this.storage.run(client, fn);
  }

  /**
   * The tenant-scoped Prisma client for the current request. Throws if
   * called outside of a request that went through TenantInterceptor —
   * there is deliberately no fallback to the raw, unscoped client, so a
   * missing guard/interceptor fails loudly instead of silently querying
   * without a tenant filter.
   */
  getClient(): TenantScopedClient {
    const client = this.storage.getStore();
    if (!client) {
      throw new Error(
        'No tenant-scoped database client in this context. ' +
          'Did the request go through TenantInterceptor?',
      );
    }
    return client;
  }
}
