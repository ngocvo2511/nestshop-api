import { ApiErrors } from '../../common/http/api-errors.decorator';
import { PaginationQueryDto } from '../../common/http/dto/pagination-query.dto';
import { inventoryHistorySchema } from './inventory.openapi';
import {
  Body,
  Get,
  Header,
  Controller,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UuidParamDto } from '../../common/http/dto/uuid-param.dto';
import { EmptyBodyPipe } from '../../common/http/empty-body.pipe';
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from '../auth/access-token.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { StockAdjustmentDto } from './inventory.dto';
import { InventoryService } from './inventory.service';

@Controller('products')
@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}
  @Get(':id/stock-adjustments')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'View stock adjustment history (ADMIN)',
    description:
      'Lists manual stock changes for this product, including who made each change, the reason, and stock before and after. Includes inactive products. Newest changes appear first; changes made at the same time are ordered by ID, descending. Use offset and limit for pagination. This list does not include stock changes from orders, cancellations or expired reservations.',
  })
  @ApiErrors('VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND')
  @ApiResponse({ status: 200, schema: inventoryHistorySchema })
  history(
    @Param() params: UuidParamDto,
    @Query() query: PaginationQueryDto,
    @Body(EmptyBodyPipe) body: Record<string, never>,
  ) {
    void body;
    return this.inventory.history(params.id, query);
  }

  @Post(':id/stock-adjustments')
  @ApiErrors(
    'VALIDATION_FAILED',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'STOCK_RANGE_EXCEEDED',
  )
  @ApiOperation({
    summary: 'Adjust product stock (ADMIN)',
    description:
      'Send quantityDelta and a reason. For example, 5 adds five units and -2 removes two units. The result cannot be negative or exceed 2147483647. Inactive products can also be adjusted. Each successful request saves a history entry. Sending the same request again applies the change again.',
  })
  @ApiResponse({
    status: 201,
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        meta: {
          type: 'object',
          properties: { correlationId: { type: 'string', format: 'uuid' } },
        },
        data: {
          type: 'object',
          additionalProperties: false,
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
        },
      },
    },
  })
  @ApiResponse({
    status: 409,
    description:
      'STOCK_RANGE_EXCEEDED: The resulting stock would be negative or too large.',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  adjust(
    @Req() request: AuthenticatedRequest,
    @Param() params: UuidParamDto,
    @Body() dto: StockAdjustmentDto,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void query;
    return this.inventory.adjust(request.identity!.sub, params.id, dto);
  }
}
