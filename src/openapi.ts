import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ShippingDto } from './modules/orders/dto/shipping.dto';
import { PaginationQueryDto } from './common/http/dto/pagination-query.dto';

export function configureOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('E-commerce Backend API')
    .setVersion('1.0.0')
    .setDescription(
      'HTTP and PostgreSQL foundation; feature APIs are added in subsequent commits. See Swagger for the implemented API contract.',
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
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: '/api/docs-json',
    swaggerOptions: { persistAuthorization: false },
  });
}
