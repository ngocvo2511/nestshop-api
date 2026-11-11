import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { json, Request, Response } from 'express';
import { ApiError } from './api-error';

export type ResponseKind = 'json' | 'provider' | 'file';
const RESPONSE_MODE = 'http.responseMode';
export const ResponseMode = (mode: ResponseKind) =>
  SetMetadata(RESPONSE_MODE, mode);

export interface ContextRequest extends Request {
  correlationId: string;
  responseMode?: ResponseKind;
}

/** Records the protocol boundary before route guards/pipes can throw. No authorization decision. */
@Injectable()
export class ResponseModeGuard implements CanActivate {
  private readonly parseJson = json({ limit: '64kb', strict: true });
  constructor(private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ContextRequest>();
    request.responseMode =
      this.reflector.getAllAndOverride<ResponseKind>(RESPONSE_MODE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'json';
    const hasBody =
      request.headers['transfer-encoding'] !== undefined ||
      (request.headers['content-length'] !== undefined &&
        request.headers['content-length'] !== '0');
    if (hasBody && ['GET', 'HEAD'].includes(request.method))
      throw new ApiError('BAD_REQUEST');
    if (
      hasBody &&
      !request.is('application/json') &&
      !request.is('multipart/form-data')
    )
      throw new ApiError('UNSUPPORTED_MEDIA_TYPE');
    // Parse after recording the handler boundary, so parser errors cannot corrupt a provider acknowledgement.
    await new Promise<void>((resolve, reject) =>
      this.parseJson(
        request,
        context.switchToHttp().getResponse<Response>(),
        (error?: unknown) => {
          if (!error) {
            resolve();
            return;
          }
          if (typeof error === 'object' && error !== null && 'type' in error) {
            if (error.type === 'entity.parse.failed') {
              reject(new ApiError('MALFORMED_JSON'));
              return;
            }
            if (error.type === 'entity.too.large') {
              reject(new ApiError('PAYLOAD_TOO_LARGE'));
              return;
            }
          }
          reject(error instanceof Error ? error : new ApiError('BAD_REQUEST'));
        },
      ),
    );
    return true;
  }
}
