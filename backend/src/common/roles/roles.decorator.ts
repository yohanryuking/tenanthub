import { SetMetadata } from '@nestjs/common';
import { MembershipRole } from '../tenant/tenant.types';

export const ROLES_KEY = 'roles';

/** Restricts a route to callers whose JWT-derived role matches one of these. */
export const Roles = (...roles: MembershipRole[]) => SetMetadata(ROLES_KEY, roles);
