import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import { TenantClaims } from '../common/tenant/tenant.types';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

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

  async findAll(query: ListTasksQueryDto) {
    const client = this.tenantContext.getClient();
    const where: Prisma.TaskWhereInput = {
      ...(query.done !== undefined ? { done: query.done } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await Promise.all([
      client.task.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      client.task.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
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

  async update(id: string, dto: UpdateTaskDto) {
    try {
      return await this.tenantContext.getClient().task.update({
        where: { id },
        data: dto,
      });
    } catch (err) {
      throw this.asNotFound(err);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.tenantContext.getClient().task.delete({ where: { id } });
    } catch (err) {
      throw this.asNotFound(err);
    }
  }

  async exportCsv(): Promise<string> {
    const tasks = await this.tenantContext.getClient().task.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const header = ['id', 'title', 'description', 'done', 'createdAt'];
    const rows = tasks.map((task) =>
      [task.id, task.title, task.description ?? '', String(task.done), task.createdAt.toISOString()]
        .map(csvEscape)
        .join(','),
    );

    return [header.join(','), ...rows].join('\n');
  }

  /**
   * Prisma's singular update()/delete() throw P2025 when the WHERE clause
   * matches zero rows. RLS makes another org's task invisible rather than
   * raising an error, so a task that exists but belongs to a different
   * tenant lands here exactly the same as one that never existed — the
   * response never reveals which case it was.
   */
  private asNotFound(err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return new NotFoundException('Task not found');
    }
    return err;
  }
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
