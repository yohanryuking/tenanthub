import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { TenantClaims } from '../common/tenant/tenant.types';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { InvitationsService } from './invitations.service';

@Controller('organizations/invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  create(@Body() dto: CreateInvitationDto, @CurrentTenant() tenant: TenantClaims) {
    return this.invitationsService.create(dto, tenant);
  }

  @Get()
  findAll(@CurrentTenant() tenant: TenantClaims) {
    return this.invitationsService.findAll(tenant);
  }
}
