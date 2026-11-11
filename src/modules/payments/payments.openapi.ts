import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
export const initiationSchema: SchemaObject = {
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [true] },
    meta: {
      type: 'object',
      properties: { correlationId: { type: 'string', format: 'uuid' } },
    },
    data: {
      type: 'object',
      additionalProperties: false,
      required: ['attempt', 'paymentUrl', 'reused'],
      properties: {
        reused: { type: 'boolean', enum: [false] },
        paymentUrl: {
          type: 'string',
          format: 'uri',
          description:
            'Sensitive signed Sandbox URL; only this owner response may expose it. Never log or list.',
        },
        attempt: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', format: 'uuid' },
            provider: { type: 'string', enum: ['VNPAY'] },
            providerReference: { type: 'string' },
            status: { type: 'string', enum: ['PENDING'] },
            amountVnd: { type: 'string', pattern: '^[1-9][0-9]{0,9}$' },
            currency: { type: 'string', enum: ['VND'] },
            createdAt: { type: 'string', format: 'date-time' },
            expiresAt: { type: 'string', format: 'date-time' },
            terminalAt: { type: 'string', nullable: true },
          },
        },
      },
    },
  },
};
