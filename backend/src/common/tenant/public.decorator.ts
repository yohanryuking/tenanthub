import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route as not requiring a verified tenant JWT (e.g. health, login). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
