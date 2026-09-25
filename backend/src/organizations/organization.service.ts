import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import { TenantClaims } from '../common/tenant/tenant.types';

@Injectable()
export class OrganizationService {
  constructor(private readonly tenantContext: TenantContextService) {}

  /**
   * Stands in for what a real billing webhook (Stripe et al.) would do on
   * a subscription event — there's no payment provider wired up, so this
   * lets an admin flip the switch directly for demoing/testing the plan
   * gate. A real integration would replace the caller of this method, not
   * its body: verify the webhook signature, map the event to a plan, then
   * call the same update.
   */
  updatePlan(plan: 'free' | 'pro', tenant: TenantClaims) {
    return this.tenantContext.getClient().organization.update({
      where: { id: tenant.orgId },
      data: { plan },
    });
  }

  getCurrent(tenant: TenantClaims) {
    return this.tenantContext.getClient().organization.findUniqueOrThrow({
      where: { id: tenant.orgId },
    });
  }
}
