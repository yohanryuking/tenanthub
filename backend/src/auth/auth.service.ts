import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { generateRefreshToken, hashRefreshToken } from './refresh-token.util';

type Role = 'admin' | 'member';
type Plan = 'free' | 'pro';

interface LoginLookupRow {
  user_id: string;
  password_hash: string;
  org_id: string;
  org_slug: string;
  role: Role;
  org_plan: Plan;
}

interface RegisterRow {
  user_id: string;
  org_id: string;
  role: Role;
  org_plan: Plan;
}

interface RefreshRow {
  user_id: string;
  org_id: string;
  role: Role;
  plan: Plan;
}

interface AcceptInvitationRow {
  org_id: string;
  role: Role;
  plan: Plan;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenPair> {
    try {
      const passwordHash = await bcrypt.hash(dto.password, 10);
      const rows = await this.prisma.$queryRaw<RegisterRow[]>`
        SELECT * FROM auth_register(${dto.orgName}, ${dto.orgSlug}, ${dto.email}, ${passwordHash})
      `;
      const row = rows[0];
      return this.issueTokenPair(row.user_id, row.org_id, row.role, row.org_plan);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2010' &&
        (err.meta as { code?: string } | undefined)?.code === '23505'
      ) {
        // Postgres unique_violation raised inside auth_register (slug or email taken).
        throw new ConflictException(
          'That organization slug or email is already in use',
        );
      }
      throw err;
    }
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    // Runs outside any tenant transaction, via the narrow SECURITY DEFINER
    // function from the Sprint 1 auth_lookup_function migration.
    const rows = await this.prisma.$queryRaw<LoginLookupRow[]>`
      SELECT * FROM auth_login_lookup(${dto.email}, ${dto.orgSlug})
    `;
    const row = rows[0];

    if (!row) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, row.password_hash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // No tenant context exists yet at this point in the request — same
    // reasoning as the auth_* lookup functions themselves, see
    // AuditLogService.writeCrossTenant.
    await this.auditLog.writeCrossTenant(row.org_id, row.user_id, 'auth.login', 'user', row.user_id);

    return this.issueTokenPair(row.user_id, row.org_id, row.role, row.org_plan);
  }

  async listOrgsForEmail(email: string) {
    return this.prisma.$queryRaw<{ org_id: string; org_slug: string; org_name: string }[]>`
      SELECT * FROM auth_list_orgs_for_email(${email})
    `;
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const tokenHash = hashRefreshToken(refreshToken);
    const rows = await this.prisma.$queryRaw<RefreshRow[]>`
      SELECT * FROM auth_consume_refresh_token(${tokenHash})
    `;
    const row = rows[0];
    if (!row) {
      // Covers: unknown token, already-used token (rotation already
      // consumed it), expired token, or a membership that was revoked
      // after the token was issued.
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    return this.issueTokenPair(row.user_id, row.org_id, row.role, row.plan);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken);
    await this.prisma.$executeRaw`SELECT auth_revoke_refresh_token(${tokenHash})`;
  }

  async acceptInvitation(token: string, password?: string): Promise<TokenPair> {
    const tokenHash = hashRefreshToken(token);

    const lookupRows = await this.prisma.$queryRaw<
      {
        org_id: string;
        org_name: string;
        email: string;
        role: Role;
        expires_at: Date;
        accepted_at: Date | null;
      }[]
    >`SELECT * FROM auth_invitation_lookup(${tokenHash})`;
    const invitation = lookupRows[0];

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.accepted_at) {
      throw new GoneException('Invitation was already accepted');
    }
    if (invitation.expires_at.getTime() < Date.now()) {
      throw new GoneException('Invitation has expired');
    }

    let user = await this.prisma.user.findUnique({
      where: { email: invitation.email },
    });

    if (!user) {
      if (!password) {
        throw new BadRequestException(
          'This email has no account yet — a password is required to create one',
        );
      }
      const passwordHash = await bcrypt.hash(password, 10);
      user = await this.prisma.user.create({
        data: { email: invitation.email, passwordHash },
      });
    }

    const acceptRows = await this.prisma.$queryRaw<AcceptInvitationRow[]>`
      SELECT out_org_id AS org_id, out_role AS role, out_plan AS plan
      FROM auth_accept_invitation(${tokenHash}, ${user.id}::uuid)
    `;
    const accepted = acceptRows[0];
    if (!accepted) {
      // Expired/accepted in the tiny window between the lookup above and
      // this call — treat it the same as "no longer valid".
      throw new GoneException('Invitation is no longer valid');
    }

    return this.issueTokenPair(user.id, accepted.org_id, accepted.role, accepted.plan);
  }

  private async issueTokenPair(
    userId: string,
    orgId: string,
    role: Role,
    plan: Plan,
  ): Promise<TokenPair> {
    const accessToken = await this.jwtService.signAsync({
      sub: userId,
      orgId,
      role,
      plan,
    });

    const refreshToken = generateRefreshToken();
    const ttlDays = this.config.get<number>('REFRESH_TOKEN_TTL_DAYS', 30);
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    await this.prisma.$executeRaw`
      SELECT auth_issue_refresh_token(
        ${userId}::uuid, ${orgId}::uuid, ${hashRefreshToken(refreshToken)}, ${expiresAt}
      )
    `;

    return { accessToken, refreshToken };
  }
}
