import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { TenantClaims } from '../tenant/tenant.types';

@Injectable()
export class AuditLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * For every audited action except login: it already runs inside the
   * caller's tenant-scoped transaction, so this is a completely ordinary
   * insert — RLS's WITH CHECK on audit_log (org_id = current org) applies
   * exactly like it would to any other table. Nothing special here, which
   * is the point: writing an audit row is no more privileged than writing
   * a task.
   */
  write(tenant: TenantClaims, action: string, entity: string, entityId?: string | null, metadata?: unknown) {
    return this.tenantContext.getClient().auditLog.create({
      data: {
        orgId: tenant.orgId,
        actorId: tenant.userId,
        action,
        entity,
        entityId: entityId ?? undefined,
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue,
      },
    });
  }

  async findAll(tenant: TenantClaims, query: { page: number; pageSize: number }) {
    const client = this.tenantContext.getClient();
    const where = { orgId: tenant.orgId };

    const [items, total] = await Promise.all([
      client.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { id: true, email: true } } },
      }),
      client.auditLog.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /**
   * Login is the one audited action with no tenant context yet — the
   * whole point of logging in is establishing one. Same narrow
   * SECURITY DEFINER pattern as every other pre-tenant-context write
   * (see audit_write_cross_tenant in the Sprint 5 migration).
   */
  async writeCrossTenant(
    orgId: string,
    actorId: string,
    action: string,
    entity: string,
    entityId?: string | null,
    metadata?: unknown,
  ) {
    await this.prisma.$executeRaw`
      SELECT audit_write_cross_tenant(
        ${orgId}::uuid,
        ${actorId}::uuid,
        ${action},
        ${entity},
        ${entityId ?? null}::uuid,
        ${JSON.stringify(metadata ?? {})}::jsonb
      )
    `;
  }
}
