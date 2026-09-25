import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Plan } from '../tenant/tenant.types';
import { REQUIRES_PLAN_KEY } from './plan.decorator';

/** Higher plans include everything lower ones can do — see RequiresPlan. */
export const PLAN_RANK: Record<Plan, number> = { free: 0, pro: 1 };

/**
 * Same shape as RolesGuard: runs after the global TenantGuard, comparing
 * request.tenant.plan (a snapshot from when the JWT was issued — see
 * docs/architecture.md) against the plan a route requires.
 */
@Injectable()
export class PlanGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPlan = this.reflector.getAllAndOverride<Plan | undefined>(REQUIRES_PLAN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPlan) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const plan = request.tenant?.plan;

    if (!plan || PLAN_RANK[plan] < PLAN_RANK[requiredPlan]) {
      throw new ForbiddenException(`This feature requires the '${requiredPlan}' plan or higher`);
    }

    return true;
  }
}
