import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ShippingDto } from './modules/orders/dto/shipping.dto';
import { PaginationQueryDto } from './common/http/dto/pagination-query.dto';

export function configureOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('E-commerce Backend API')
    .setVersion('1.0.0')
    .setDescription(
      'Accounts, catalog, audited inventory, stock-safe own orders/cancellation and STAFF fulfillment, plus owner-only VNPay Sandbox URL initiation. Verified IPN settlement, non-settling return and read-only Admin reconciliation implemented. Startup/periodic order expiration releases reserved stock once; genuine Sandbox acceptance remains unverified. See Swagger for the implemented API contract.',
    )
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [PaginationQueryDto, ShippingDto],
  });
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.ErrorEnvelope = {
    type: 'object',
    required: ['success', 'error', 'meta'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      error: {
        type: 'object',
        required: ['status', 'code', 'message'],
        properties: {
          status: { type: 'integer' },
          code: { type: 'string' },
          message: { type: 'string' },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                rules: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      meta: {
        type: 'object',
        properties: { correlationId: { type: 'string', format: 'uuid' } },
      },
    },
  };
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of ['get', 'post', 'patch', 'put', 'delete'] as const) {
      const operation = item?.[method];
      if (!operation) continue;
      const provider = path === '/api/v1/payments/vnpay/ipn';
      const authenticated =
        operation.security?.some((entry) => 'bearer' in entry) ?? false;
      const roles = !authenticated
        ? []
        : path.includes('/admin/') ||
            (path.includes('/products') && method !== 'get')
          ? ['ADMIN']
          : path.includes('/staff/')
            ? ['STAFF', 'ADMIN']
            : path.includes('/orders')
              ? ['CUSTOMER']
              : ['CUSTOMER', 'STAFF', 'ADMIN'];
      Object.assign(operation, { 'x-roles': roles });
      Object.assign(operation, {
        'x-authentication': authenticated
          ? 'bearer'
          : provider || path.endsWith('/vnpay/return')
            ? 'provider-signature'
            : path.endsWith('/auth/logout') || path.endsWith('/auth/refresh')
              ? 'refresh-token'
              : 'public',
      });
      operation.parameters ??= [];
      for (const parameter of operation.parameters) {
        if ('$ref' in parameter) continue;
        if (
          ['offset', 'limit'].includes(parameter.name) &&
          parameter.schema &&
          !('$ref' in parameter.schema)
        )
          parameter.schema.type = 'integer';
        if (parameter.in === 'path')
          parameter.schema = { type: 'string', format: 'uuid' };
      }
      operation.responses ??= {};
      if (!provider) {
        for (const [status, description] of [
          ['500', 'Safe INTERNAL_ERROR; no SQL/stack/secret disclosure'],
          ['503', 'SERVICE_UNAVAILABLE / PAYMENT_UNAVAILABLE where applicable'],
        ])
          operation.responses[status] ??= { description };
        for (const [status, response] of Object.entries(operation.responses)) {
          if (Number(status) >= 400 && response && !('$ref' in response))
            response.content ??= {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorEnvelope' },
              },
            };
        }
      }
    }
  }
  // Input object schemas reflect the strict whitelist; protected/unknown fields reject.
  for (const [name, schema] of Object.entries(document.components.schemas)) {
    if (!name.endsWith('Dto') || '$ref' in schema || schema.type !== 'object')
      continue;
    schema.additionalProperties = false;
    for (const [field, property] of Object.entries(schema.properties ?? {})) {
      if (
        !('$ref' in property) &&
        [
          'offset',
          'limit',
          'quantity',
          'initialStock',
          'quantityDelta',
        ].includes(field)
      )
        property.type = 'integer';
    }
  }
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: '/api/docs-json',
    swaggerOptions: { persistAuthorization: false },
  });
}
