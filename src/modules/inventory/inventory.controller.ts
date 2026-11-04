import {
  Body,
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
import { ProductErrors } from '../products/products.openapi';
import { StockAdjustmentDto } from './inventory.dto';
import { InventoryService } from './inventory.service';

@Controller('products')
@ApiTags('inventory')
@ApiBearerAuth()
@ProductErrors()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}
  @Post(':id/stock-adjustments')
  @ApiOperation({
    summary: 'ADMIN atomic audited stock delta',
    description:
      'Locks/reloads product, checks integer range/nonnegative result and writes stock plus audit in one transaction. Inactive targets permitted. Each successful request is additive, not idempotent; repeat creates another audit.',
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
    description: 'STOCK_RANGE_EXCEEDED',
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
