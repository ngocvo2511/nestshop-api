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
        'Price in whole VND, returned as a string, such as "350000". Maximum: 9223372036854775807.',
    },
    stockAvailable: { type: 'integer', minimum: 0, maximum: 2147483647 },
    isActive: { type: 'boolean' },
    imageUrl: {
      type: 'string',
      nullable: true,
      description:
        'Image path relative to the API host. Only active product images are public. null means no image has been uploaded.',
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
