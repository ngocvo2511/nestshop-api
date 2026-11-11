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
    summary: 'Public process liveness; no database/provider details',
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
    description: 'Unknown query/input validation failure',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  @ApiResponse({
    status: 500,
    description: 'Safe internal error',
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
