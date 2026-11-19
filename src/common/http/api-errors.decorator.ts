import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorCode, errorCatalog } from './api-error';

/** Describe only the errors applicable to the operation, grouped by HTTP status. */
export function ApiErrors(...codes: ErrorCode[]) {
  const groups = new Map<number, ErrorCode[]>();
  for (const code of new Set([
    ...codes,
    'INTERNAL_ERROR',
    'SERVICE_UNAVAILABLE',
  ] as ErrorCode[])) {
    const status = errorCatalog[code][0];
    groups.set(status, [...(groups.get(status) ?? []), code]);
  }
  return applyDecorators(
    ...[...groups].map(([status, entries]) =>
      ApiResponse({
        status,
        description: entries
          .map((code) => `${code}: ${errorCatalog[code][1]}`)
          .join('; '),
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            examples: Object.fromEntries(
              entries.map((code) => [
                code,
                {
                  value: {
                    success: false,
                    error: { status, code, message: errorCatalog[code][1] },
                    meta: {
                      correlationId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
                    },
                  },
                },
              ]),
            ),
          },
        },
      }),
    ),
  );
}
