import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantClaims } from './tenant.types';

/** Injects the verified tenant claims ({ userId, orgId, role }) into a handler. */
export const CurrentTenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TenantClaims => {
    const request = ctx.switchToHttp().getRequest();
    return request.tenant;
  },
);
