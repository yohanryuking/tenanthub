import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { TenantClaims } from '../common/tenant/tenant.types';
import { Roles } from '../common/roles/roles.decorator';
import { RolesGuard } from '../common/roles/roles.guard';
import { AuditLogService } from '../common/audit/audit-log.service';
import { ListAuditLogQueryDto } from './dto/list-audit-log-query.dto';

@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Roles('admin')
  @UseGuards(RolesGuard)
  @Get()
  findAll(@Query() query: ListAuditLogQueryDto, @CurrentTenant() tenant: TenantClaims) {
    return this.auditLogService.findAll(tenant, query);
  }
}
