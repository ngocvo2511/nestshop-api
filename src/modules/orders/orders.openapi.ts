import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

const money: SchemaObject = {
  type: 'string',
  pattern: '^[1-9][0-9]{0,18}$',
  description:
    'Server-calculated integer VND decimal string, <=9223372036854775807; never a JSON number.',
};
export const checkoutSchema: SchemaObject = {
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
      additionalProperties: false,
      required: [
        'id',
        'status',
        'totalVnd',
        'createdAt',
        'updatedAt',
        'reservationExpiresAt',
        'paymentSummary',
        'shipping',
        'items',
      ],
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: ['PENDING_PAYMENT'] },
        totalVnd: money,
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        reservationExpiresAt: { type: 'string', format: 'date-time' },
        paymentSummary: {
          type: 'object',
          properties: {
            latestAttempt: { type: 'object', nullable: true },
            successfulAttempt: { type: 'object', nullable: true },
          },
        },
        shipping: { $ref: '#/components/schemas/ShippingDto' },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'id',
              'productId',
              'productName',
              'unitPriceVnd',
              'quantity',
              'lineTotalVnd',
            ],
            properties: {
              id: { type: 'string', format: 'uuid' },
              productId: { type: 'string', format: 'uuid' },
              productName: { type: 'string' },
              unitPriceVnd: money,
              quantity: { type: 'integer', minimum: 1, maximum: 2147483647 },
              lineTotalVnd: money,
            },
          },
        },
      },
    },
  },
};
