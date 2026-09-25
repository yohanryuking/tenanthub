import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY } from './roles.decorator';

/**
 * Reusable version of what InvitationsService did by hand in Sprint 2
 * (`if (tenant.role !== 'admin') throw new ForbiddenException(...)`).
 * Runs after TenantGuard (a global guard registered in TenantModule),
 * which is why request.tenant is already populated here — this guard only
 * ever restricts further, it never resolves the tenant itself.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const role = request.tenant?.role;

    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException(
        `This action requires one of these roles: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
