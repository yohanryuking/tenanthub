import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';

@Module({
  controllers: [InvitationsController, MembershipsController],
  providers: [InvitationsService, MembershipsService],
})
export class OrganizationsModule {}
