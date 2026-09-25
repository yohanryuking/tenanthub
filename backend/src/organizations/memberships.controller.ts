import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { TenantClaims } from '../common/tenant/tenant.types';
import { Roles } from '../common/roles/roles.decorator';
import { RolesGuard } from '../common/roles/roles.guard';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import { MembershipsService } from './memberships.service';

@Controller('memberships')
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Get()
  findAll(@CurrentTenant() tenant: TenantClaims) {
    return this.membershipsService.findAll(tenant);
  }

  @Roles('admin')
  @UseGuards(RolesGuard)
  @Patch(':id')
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateMembershipDto,
    @CurrentTenant() tenant: TenantClaims,
  ) {
    return this.membershipsService.updateRole(id, dto.role, tenant);
  }
}
