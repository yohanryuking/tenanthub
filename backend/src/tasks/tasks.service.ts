import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import { TenantClaims } from '../common/tenant/tenant.types';
import { CreateTaskDto } from './dto/create-task.dto';

/**
 * Deliberately does NOT filter by orgId anywhere in this file. Every query
 * below runs through TenantContextService.getClient(), which is the Prisma
 * transaction client that already has app.current_org set for this
 * request — Postgres RLS is what actually restricts these queries to the
 * caller's organization. This is the point of the whole exercise: even if
 * a `where: { orgId }` were forgotten here, the database still wouldn't
 * return another tenant's rows.
 */
@Injectable()
export class TasksService {
  constructor(private readonly tenantContext: TenantContextService) {}

  findAll() {
    return this.tenantContext.getClient().task.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  create(dto: CreateTaskDto, tenant: TenantClaims) {
    return this.tenantContext.getClient().task.create({
      data: {
        title: dto.title,
        description: dto.description,
        orgId: tenant.orgId,
        createdBy: tenant.userId,
      },
    });
  }
}
