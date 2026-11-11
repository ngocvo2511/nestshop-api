import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { ApiError, ValidationDetail } from './api-error';

function details(
  errors: ValidationError[],
  parent = '',
  depth = 0,
): ValidationDetail[] {
  if (depth > 8) return [];
  return errors
    .flatMap((error) => {
      const segment =
        typeof error.property === 'string' &&
        /^[A-Za-z0-9_]{1,64}$/.test(error.property)
          ? error.property
          : 'field';
      const field = parent ? `${parent}.${segment}` : segment;
      const own = error.constraints
        ? [{ field, rules: Object.keys(error.constraints).slice(0, 8) }]
        : [];
      return [...own, ...details(error.children ?? [], field, depth + 1)];
    })
    .slice(0, 20);
}

class StrictValidationPipe extends ValidationPipe {
  async transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<unknown> {
    this.checkStructure(value);
    return super.transform(value, metadata);
  }

  private checkStructure(value: unknown, depth = 1): void {
    if (typeof value !== 'object' || value === null) return;
    if (depth > 16)
      throw new ApiError('VALIDATION_FAILED', [
        { field: 'input', rules: ['maxDepth'] },
      ]);
    for (const key of Object.keys(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw new ApiError('VALIDATION_FAILED', [
          { field: 'input', rules: ['forbiddenProperty'] },
        ]);
      this.checkStructure((value as Record<string, unknown>)[key], depth + 1);
    }
  }

  // Nest also has a separate primitive query/param coercion path. Keep it off;
  // input validation uses class DTOs and explicit, bounded transforms only.
  protected transformPrimitive(value: unknown): unknown {
    return value;
  }
}

export function strictValidationPipe(): ValidationPipe {
  return new StrictValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new ApiError('VALIDATION_FAILED', details(errors)),
  });
}
