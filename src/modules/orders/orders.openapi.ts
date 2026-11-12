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

const attempt: SchemaObject = {
  type: 'object',
  nullable: true,
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    provider: { type: 'string', enum: ['VNPAY'] },
    providerReference: { type: 'string' },
    status: {
      type: 'string',
      enum: ['PENDING', 'SUCCESS', 'FAILED', 'EXPIRED'],
    },
    amountVnd: money,
    currency: { type: 'string', enum: ['VND'] },
    createdAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' },
    terminalAt: { type: 'string', format: 'date-time', nullable: true },
  },
};
const detail = structuredClone(checkoutSchema.properties!.data) as SchemaObject;
detail.properties!.status = {
  type: 'string',
  enum: [
    'PENDING_PAYMENT',
    'PAID',
    'PROCESSING',
    'SHIPPED',
    'COMPLETED',
    'CANCELLED',
    'EXPIRED',
  ],
};
detail.properties!.paymentSummary = {
  type: 'object',
  properties: { latestAttempt: attempt, successfulAttempt: attempt },
};
const summary = structuredClone(detail);
delete summary.properties!.items;
delete summary.properties!.shipping;
summary.required = summary.required!.filter(
  (k) => k !== 'items' && k !== 'shipping',
);
const envelope = (data: SchemaObject): SchemaObject => ({
  ...checkoutSchema,
  properties: { ...checkoutSchema.properties, data },
});
const page = (items: SchemaObject): SchemaObject => ({
  type: 'object',
  properties: {
    items: { type: 'array', items },
    offset: { type: 'integer' },
    limit: { type: 'integer' },
    total: { type: 'integer' },
  },
});
export const orderDetailSchema = envelope(detail);
export const orderListSchema = envelope(page(summary));
export const cancellationSchema = envelope({
  type: 'object',
  properties: { order: summary, changed: { type: 'boolean' } },
});
export const historySchema = envelope(
  page({
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      previousStatus: { type: 'string', nullable: true },
      newStatus: { type: 'string' },
      actorType: { type: 'string', enum: ['USER', 'SYSTEM'] },
      actorUserId: { type: 'string', format: 'uuid', nullable: true },
      note: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  }),
);
