import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export type Role = 'ADMIN' | 'FIELD_OFFICER' | 'EXECUTIVE';

export interface AuthUser {
  id: string;
  role: Role;
  deviceId?: string;
}

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
