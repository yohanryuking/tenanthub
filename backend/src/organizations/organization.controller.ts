import { Body, Controller, Get, Patch, UseGuards, UseInterceptors } from '@nestjs/common';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { TenantClaims } from '../common/tenant/tenant.types';
import { Roles } from '../common/roles/roles.decorator';
import { RolesGuard } from '../common/roles/roles.guard';
import { Audit } from '../common/audit/audit.decorator';
import { AuditInterceptor } from '../common/audit/audit.interceptor';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { OrganizationService } from './organization.service';

@Controller('organizations')
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Get('me')
  getCurrent(@CurrentTenant() tenant: TenantClaims) {
    return this.organizationService.getCurrent(tenant);
  }

  @Roles('admin')
  @UseGuards(RolesGuard)
  @Audit('organization.plan_changed', 'organization')
  @UseInterceptors(AuditInterceptor)
  @Patch('plan')
  updatePlan(@Body() dto: UpdatePlanDto, @CurrentTenant() tenant: TenantClaims) {
    return this.organizationService.updatePlan(dto.plan, tenant);
  }
}
