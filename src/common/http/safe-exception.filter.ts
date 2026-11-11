import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiError, ErrorCode, errorCatalog } from './api-error';
import { ContextRequest } from './response-mode';

const statusCodes: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  503: 'SERVICE_UNAVAILABLE',
};

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<ContextRequest>();
    const response = host.switchToHttp().getResponse<Response>();
    this.respond(error, request, response);
  }

  respond(error: unknown, request: ContextRequest, response: Response): void {
    if (response.headersSent) {
      response.end();
      return;
    }
    if (request.responseMode === 'provider') {
      response.status(200).json({ RspCode: '99', Message: 'Processing error' });
      return;
    }
    let code: ErrorCode = 'INTERNAL_ERROR';
    if (error instanceof ApiError) code = error.code;
    else if (error instanceof HttpException)
      code = statusCodes[error.getStatus()] ?? 'INTERNAL_ERROR';
    else if (typeof error === 'object' && error !== null && 'type' in error) {
      if (error.type === 'entity.parse.failed') code = 'MALFORMED_JSON';
      if (error.type === 'entity.too.large') code = 'PAYLOAD_TOO_LARGE';
    }
    const [status, message] = errorCatalog[code];
    response.status(status).json({
      success: false,
      error: {
        status,
        code,
        message,
        ...(error instanceof ApiError && error.details
          ? { details: error.details }
          : {}),
      },
      meta: { correlationId: request.correlationId },
    });
  }
}
