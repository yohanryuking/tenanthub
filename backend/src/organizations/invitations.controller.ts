import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { TenantClaims } from '../common/tenant/tenant.types';
import { Roles } from '../common/roles/roles.decorator';
import { RolesGuard } from '../common/roles/roles.guard';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { InvitationsService } from './invitations.service';

@Controller('organizations/invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Roles('admin')
  @UseGuards(RolesGuard)
  @Post()
  create(@Body() dto: CreateInvitationDto, @CurrentTenant() tenant: TenantClaims) {
    return this.invitationsService.create(dto, tenant);
  }

  @Get()
  findAll(@CurrentTenant() tenant: TenantClaims) {
    return this.invitationsService.findAll(tenant);
  }
}
