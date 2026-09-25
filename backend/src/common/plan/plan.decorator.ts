import { SetMetadata } from '@nestjs/common';
import { Plan } from '../tenant/tenant.types';

export const REQUIRES_PLAN_KEY = 'requiresPlan';

/** Restricts a route to organizations on this plan or higher (see PLAN_RANK). */
export const RequiresPlan = (plan: Plan) => SetMetadata(REQUIRES_PLAN_KEY, plan);
