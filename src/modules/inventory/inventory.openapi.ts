import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

const adjustment: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'productId',
    'actorUserId',
    'previousStock',
    'quantityDelta',
    'newStock',
    'reason',
    'createdAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    productId: { type: 'string', format: 'uuid' },
    actorUserId: { type: 'string', format: 'uuid' },
    previousStock: { type: 'integer' },
    quantityDelta: { type: 'integer' },
    newStock: { type: 'integer' },
    reason: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};
export const inventoryHistorySchema: SchemaObject = {
  type: 'object',
  required: ['success', 'data', 'meta'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    meta: {
      type: 'object',
      properties: { correlationId: { type: 'string', format: 'uuid' } },
    },
    data: {
      type: 'object',
      required: ['items', 'offset', 'limit', 'total'],
      properties: {
        items: { type: 'array', items: adjustment },
        offset: { type: 'integer' },
        limit: { type: 'integer' },
        total: { type: 'integer' },
      },
    },
  },
};
