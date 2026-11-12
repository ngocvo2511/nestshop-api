import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { initiationSchema } from './payments.openapi';
const envelope = (data: SchemaObject): SchemaObject => ({
  type: 'object',
  required: ['success', 'data', 'meta'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data,
    meta: {
      type: 'object',
      properties: { correlationId: { type: 'string', format: 'uuid' } },
    },
  },
});
const page = (items: SchemaObject): SchemaObject => ({
  type: 'object',
  required: ['items', 'total', 'offset', 'limit'],
  properties: {
    items: { type: 'array', items },
    total: { type: 'integer' },
    offset: { type: 'integer' },
    limit: { type: 'integer' },
  },
});
const nullableText: SchemaObject = { type: 'string', nullable: true };
const payment = structuredClone(
  (initiationSchema.properties!.data as SchemaObject).properties!.attempt,
) as SchemaObject;
payment.properties!.status = {
  type: 'string',
  enum: ['PENDING', 'SUCCESS', 'FAILED', 'EXPIRED'],
};
payment.properties!.amountVnd = {
  type: 'string',
  pattern: '^[1-9][0-9]{0,18}$',
};
payment.properties!.orderId = { type: 'string', format: 'uuid' };
payment.properties!.providerTransactionReference = nullableText;
payment.properties!.responseCode = nullableText;
payment.properties!.transactionStatusCode = nullableText;
payment.required = Object.keys(payment.properties!);
export const adminPaymentSchema = envelope(payment);
export const adminPaymentsSchema = envelope(page(payment));
export const paymentReceiptsSchema = envelope(
  page({
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string', format: 'uuid' },
      paymentId: { type: 'string', format: 'uuid', nullable: true },
      correlationId: { type: 'string', format: 'uuid' },
      providerReference: nullableText,
      providerTransactionReference: nullableText,
      signatureVerified: { type: 'boolean' },
      reportedAmountVnd: nullableText,
      reportedCurrency: nullableText,
      responseCode: nullableText,
      transactionStatusCode: nullableText,
      outcome: {
        type: 'string',
        enum: [
          'SETTLED',
          'FAILED',
          'DUPLICATE',
          'INVALID',
          'MISMATCH',
          'UNKNOWN_REFERENCE',
          'LATE',
          'CONFLICT',
        ],
      },
      safeDetail: {
        type: 'string',
        nullable: true,
        description: 'Fixed bounded diagnostic code, never raw provider data',
      },
      receivedAt: { type: 'string', format: 'date-time' },
    },
  }),
);
export const browserReturnSchema = envelope({
  type: 'object',
  additionalProperties: false,
  required: ['reference', 'providerResponseCode', 'settlementAuthoritative'],
  properties: {
    reference: { type: 'string', maxLength: 100 },
    providerResponseCode: { type: 'string', pattern: '^[0-9]{2}$' },
    settlementAuthoritative: { type: 'boolean', enum: [false] },
  },
});
