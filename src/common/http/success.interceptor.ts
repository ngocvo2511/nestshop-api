import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, map } from 'rxjs';
import { ContextRequest } from './response-mode';

@Injectable()
export class SuccessInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<ContextRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((value: unknown) => {
        if (response.statusCode === 204) return undefined;
        if (
          request.responseMode === 'provider' ||
          request.responseMode === 'file' ||
          value instanceof StreamableFile ||
          response.headersSent
        )
          return value;
        return {
          success: true,
          data: value ?? null,
          meta: { correlationId: request.correlationId },
        };
      }),
    );
  }
}
