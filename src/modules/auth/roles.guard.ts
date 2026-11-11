import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from '../../common/http/api-error';
import { AuthenticatedRequest } from './access-token.guard';

export const accountRoles = ['CUSTOMER', 'STAFF', 'ADMIN'] as const;
export type AccountRole = (typeof accountRoles)[number];
const rolesKey = Symbol('allowedRoles');
export const Roles = (...roles: AccountRole[]) => SetMetadata(rolesKey, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<AccountRole[]>(rolesKey, [
      context.getHandler(),
      context.getClass(),
    ]);
    const identity = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().identity;
    if (!identity) throw new ApiError('UNAUTHORIZED');
    if (roles && !roles.some((role) => role === identity.role))
      throw new ApiError('FORBIDDEN');
    return true;
  }
}
