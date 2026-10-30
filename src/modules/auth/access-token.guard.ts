import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ApiError } from '../../common/http/api-error';
import { AccessTokenService } from './access-token.service';

export type AuthenticatedRequest = Request & {
  identity?: { sub: string; role: string };
};

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly tokens: AccessTokenService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (
      typeof authorization !== 'string' ||
      !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization) ||
      authorization.length > 4096
    )
      throw new ApiError('UNAUTHORIZED');
    request.identity = await this.tokens.verify(authorization.slice(7));
    return true;
  }
}
