import { Injectable, PipeTransform } from '@nestjs/common';
import { ApiError } from './api-error';

@Injectable()
export class EmptyBodyPipe implements PipeTransform<
  unknown,
  Record<string, never>
> {
  transform(value: unknown): Record<string, never> {
    if (
      value === undefined ||
      (typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0)
    )
      return {};
    throw new ApiError('VALIDATION_FAILED', [
      { field: 'body', rules: ['emptyObject'] },
    ]);
  }
}
