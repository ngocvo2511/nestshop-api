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
            'Open this link in a browser to pay in VNPay Sandbox. It is returned only to the customer who owns the order. Do not share or log this link.',
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
            expiresAt: {
              type: 'string',
              format: 'date-time',
              description:
                'Deadline for this payment attempt, in UTC. Passing this time alone does not automatically change PENDING to EXPIRED.',
            },
            terminalAt: {
              type: 'string',
              nullable: true,
              description:
                'When the payment attempt was closed. null means it has not been closed yet.',
            },
          },
        },
      },
    },
  },
};
