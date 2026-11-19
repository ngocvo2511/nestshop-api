import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiResponse,
} from '@nestjs/swagger';
import { ApiError } from '../../common/http/api-error';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Check whether the API is running',
  })
  @ApiHeader({
    name: 'X-Correlation-ID',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({
    headers: {
      'X-Correlation-ID': { schema: { type: 'string', format: 'uuid' } },
    },
    schema: {
      type: 'object',
      required: ['success', 'data', 'meta'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          required: ['status'],
          properties: { status: { type: 'string', enum: ['ok'] } },
        },
        meta: {
          type: 'object',
          required: ['correlationId'],
          properties: { correlationId: { type: 'string', format: 'uuid' } },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED: This endpoint does not accept query parameters.',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  @ApiResponse({
    status: 500,
    description: 'INTERNAL_ERROR: The server could not complete the request.',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  getHealth(@Query() query: Record<string, unknown>) {
    if (Object.keys(query).length)
      throw new ApiError('VALIDATION_FAILED', [
        { field: 'query', rules: ['noQueryParameters'] },
      ]);
    return { status: 'ok' };
  }
}
