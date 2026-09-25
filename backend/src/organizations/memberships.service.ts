import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import { TenantClaims } from '../common/tenant/tenant.types';

@Injectable()
export class MembershipsService {
  constructor(private readonly tenantContext: TenantContextService) {}

  findAll(tenant: TenantClaims) {
    return this.tenantContext.getClient().membership.findMany({
      where: { orgId: tenant.orgId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, email: true } } },
    });
  }

  async updateRole(id: string, role: 'admin' | 'member', tenant: TenantClaims) {
    const client = this.tenantContext.getClient();

    // Serializes concurrent role changes for this org: two simultaneous
    // "demote an admin" requests could otherwise both read "there's
    // another admin" before either commits, and leave the org with zero
    // admins. Locking every admin row in the org first makes the second
    // request wait for the first transaction to finish, so its recount
    // below sees the first change.
    await client.$executeRaw`
      SELECT id FROM memberships
      WHERE org_id = ${tenant.orgId}::uuid AND role = 'admin'
      FOR UPDATE
    `;

    const target = await client.membership.findUnique({ where: { id } });
    if (!target) {
      // Same reasoning as tasks: RLS hides another org's membership rather
      // than the query rejecting them, so "doesn't exist" and "exists but
      // isn't yours" must look identical from the outside.
      throw new NotFoundException('Membership not found');
    }

    if (target.role === 'admin' && role === 'member') {
      const otherAdmins = await client.membership.count({
        where: { orgId: tenant.orgId, role: 'admin', NOT: { id } },
      });
      if (otherAdmins === 0) {
        throw new ConflictException(
          'Cannot remove the last admin of an organization',
        );
      }
    }

    return client.membership.update({
      where: { id },
      data: { role },
      include: { user: { select: { id: true, email: true } } },
    });
  }
}
