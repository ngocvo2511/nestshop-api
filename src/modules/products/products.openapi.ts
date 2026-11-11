import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

const product: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'name',
    'description',
    'priceVnd',
    'stockAvailable',
    'isActive',
    'imageUrl',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', maxLength: 250 },
    description: { type: 'string', nullable: true },
    priceVnd: {
      type: 'string',
      pattern: '^[1-9][0-9]{0,18}$',
      description:
        'Integer VND, at most 9223372036854775807; never a JSON number.',
    },
    stockAvailable: { type: 'integer', minimum: 0, maximum: 2147483647 },
    isActive: { type: 'boolean' },
    imageUrl: {
      type: 'string',
      nullable: true,
      description:
        'Relative active-only image URL; null when no image is assigned.',
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};
export function productSchema(list = false): SchemaObject {
  return {
    type: 'object',
    required: ['success', 'data', 'meta'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      meta: {
        type: 'object',
        properties: { correlationId: { type: 'string', format: 'uuid' } },
      },
      data: list
        ? {
            type: 'object',
            required: ['items', 'offset', 'limit', 'total'],
            properties: {
              items: { type: 'array', items: product },
              offset: { type: 'integer' },
              limit: { type: 'integer' },
              total: { type: 'integer' },
            },
          }
        : product,
    },
  };
}
export function ProductErrors() {
  return applyDecorators(
    ...[400, 401, 403, 404, 500, 503].map((status) =>
      ApiResponse({
        status,
        description:
          status === 400
            ? 'VALIDATION_FAILED / EMPTY_UPDATE'
            : status === 404
              ? 'NOT_FOUND; missing/inactive share the public response'
              : 'Safe catalog error',
        schema: { $ref: '#/components/schemas/ErrorEnvelope' },
      }),
    ),
  );
}
