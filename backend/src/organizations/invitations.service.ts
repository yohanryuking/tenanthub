import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import { TenantClaims } from '../common/tenant/tenant.types';
import { generateRefreshToken, hashRefreshToken } from '../auth/refresh-token.util';
import { CreateInvitationDto } from './dto/create-invitation.dto';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateInvitationDto, tenant: TenantClaims) {
    const token = generateRefreshToken();
    const ttlDays = this.config.get<number>('INVITATION_TTL_DAYS', 7);
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    const invitation = await this.tenantContext.getClient().invitation.create({
      data: {
        orgId: tenant.orgId,
        email: dto.email,
        role: dto.role,
        tokenHash: hashRefreshToken(token),
        invitedBy: tenant.userId,
        expiresAt,
      },
    });

    // Phase 1/2 has no SMTP integration — this is the documented extension
    // point (same pattern as the Sprint 5 "here's where Stripe would plug
    // in" note). Logging the token is what makes the flow demoable/testable
    // without a real mail provider.
    this.logger.log(
      `Invitation for ${dto.email} to org ${tenant.orgId}: token=${token} (would be emailed)`,
    );

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      token, // dev-only convenience: a real deployment would email this, not return it.
    };
  }

  findAll(tenant: TenantClaims) {
    return this.tenantContext.getClient().invitation.findMany({
      where: { orgId: tenant.orgId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
