import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import { SafeJsonLogger } from '../logging/safe-json.logger';
import { ContextRequest } from './response-mode';

export function requestContext(logger: SafeJsonLogger) {
  return (
    request: ContextRequest,
    response: Response,
    next: NextFunction,
  ): void => {
    const incoming = request.headers['x-correlation-id'];
    request.correlationId =
      typeof incoming === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        incoming,
      )
        ? incoming.toLowerCase()
        : randomUUID();
    response.setHeader('X-Correlation-ID', request.correlationId);
    const started = process.hrtime.bigint();
    response.once('finish', () =>
      logger.httpCompleted(
        request.correlationId,
        request.method,
        response.statusCode,
        Number(process.hrtime.bigint() - started) / 1000000,
      ),
    );
    next();
  };
}
