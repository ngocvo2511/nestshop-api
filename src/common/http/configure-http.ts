import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SafeJsonLogger } from '../logging/safe-json.logger';
import { requestContext } from './request-context.middleware';
import { ResponseModeGuard } from './response-mode';
import { SafeExceptionFilter } from './safe-exception.filter';
import { SuccessInterceptor } from './success.interceptor';
import { strictValidationPipe } from './validation.pipe';
import { ApiError } from './api-error';
import type { NextFunction, Response } from 'express';
import { ContextRequest } from './response-mode';

/** Call before init/listen; create the Express Nest app with bodyParser:false. */
export function configureHttp(
  app: INestApplication,
  logger: SafeJsonLogger,
): void {
  const adapter = app.getHttpAdapter();
  const express = adapter.getInstance() as {
    set: (key: string, value: unknown) => void;
    disable: (key: string) => void;
  };
  express.set('query parser', 'simple');
  express.disable('x-powered-by');
  app.use(requestContext(logger));
  app.setGlobalPrefix('api/v1');
  app.useGlobalGuards(new ResponseModeGuard(app.get(Reflector)));
  app.useGlobalPipes(strictValidationPipe());
  app.useGlobalInterceptors(new SuccessInterceptor());
  app.useGlobalFilters(new SafeExceptionFilter());
}

/** Install after Nest routes, also covering misses/errors outside the global prefix. */
export async function initializeHttp(app: INestApplication): Promise<void> {
  await app.init();
  const filter = new SafeExceptionFilter();
  app.use((request: ContextRequest, response: Response) =>
    filter.respond(new ApiError('NOT_FOUND'), request, response),
  );
  app.use(
    (
      error: unknown,
      request: ContextRequest,
      response: Response,
      next: NextFunction,
    ) => {
      void next; // Keep Express's four-argument error-middleware signature.
      if (response.headersSent) {
        response.end();
        return;
      }
      filter.respond(error, request, response);
    },
  );
}
