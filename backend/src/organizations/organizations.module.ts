import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { AuditLogController } from './audit-log.controller';

@Module({
  controllers: [
    InvitationsController,
    MembershipsController,
    OrganizationController,
    AuditLogController,
  ],
  providers: [InvitationsService, MembershipsService, OrganizationService],
})
export class OrganizationsModule {}
