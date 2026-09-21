import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';
import { TenantClaims } from './tenant.types';

/**
 * Global guard: decodes and verifies the Bearer JWT and derives the tenant
 * context (userId, orgId, role) from its signed payload. The org a request
 * acts on is therefore whatever org the token was issued for — it can never
 * be overridden by a header, query param, or request body.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    const request = context.switchToHttp().getRequest<Request>();

    if (isPublic) {
      return true;
    }

    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const payload = this.jwtService.verify<{
        sub: string;
        orgId: string;
        role: 'admin' | 'member';
      }>(token);
      const claims: TenantClaims = {
        userId: payload.sub,
        orgId: payload.orgId,
        role: payload.role,
      };
      request.tenant = claims;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;
    const [type, token] = header.split(' ');
    return type === 'Bearer' ? token : undefined;
  }
}
