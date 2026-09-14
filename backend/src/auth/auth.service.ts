import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../common/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

interface LoginLookupRow {
  user_id: string;
  password_hash: string;
  org_id: string;
  org_slug: string;
  role: 'admin' | 'member';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    // Runs outside any tenant transaction, on the narrow SECURITY DEFINER
    // function created in the auth_lookup_function migration — see that
    // migration's comment for why this is not a general RLS bypass.
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

    const accessToken = await this.jwtService.signAsync({
      sub: row.user_id,
      orgId: row.org_id,
      role: row.role,
    });

    return { accessToken };
  }
}
