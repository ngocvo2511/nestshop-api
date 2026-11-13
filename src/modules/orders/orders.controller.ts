import {
  Body,
  Get,
  Param,
  ParseUUIDPipe,
  HttpCode,
  Controller,
  Header,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { EmptyBodyPipe } from '../../common/http/empty-body.pipe';
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from '../auth/access-token.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CheckoutDto } from './dto/checkout.dto';
import { OrdersService } from './orders.service';
import { OrderQueryDto } from './dto/order-query.dto';
import { PaginationQueryDto } from '../../common/http/dto/pagination-query.dto';
import {
  checkoutSchema,
  orderDetailSchema,
  orderListSchema,
  cancellationSchema,
  historySchema,
} from './orders.openapi';

@Controller('orders')
@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('CUSTOMER')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Get()
  @ApiResponse({ status: 200, schema: orderListSchema })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
  @ApiResponse({ status: 403, description: 'CUSTOMER only' })
  @ApiResponse({ status: 404, description: 'Missing or foreign order' })
  @ApiResponse({ status: 400, description: 'VALIDATION_FAILED' })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List own orders',
    description:
      'Own records only; offset0..1000000, limit1..100 default20. Optional canonical status; sort createdAt/-createdAt default descending, matching ID tie-break. Safe payment summaries only.',
  })
  list(@Req() req: AuthenticatedRequest, @Query() query: OrderQueryDto) {
    return this.orders.list(req.identity!.sub, query);
  }

  @Get(':id')
  @ApiResponse({ status: 200, schema: orderDetailSchema })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
  @ApiResponse({ status: 403, description: 'CUSTOMER only' })
  @ApiResponse({ status: 404, description: 'Missing or foreign order' })
  @ApiResponse({ status: 400, description: 'VALIDATION_FAILED' })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Own order snapshots and safe payment summary; missing/foreign404',
  })
  detail(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void query;
    return this.orders.detail(req.identity!.sub, id);
  }

  @Get(':id/history')
  @ApiResponse({ status: 200, schema: historySchema })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
  @ApiResponse({ status: 403, description: 'CUSTOMER only' })
  @ApiResponse({ status: 404, description: 'Missing or foreign order' })
  @ApiResponse({ status: 400, description: 'VALIDATION_FAILED' })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Own order history; missing/foreign404',
    description:
      'offset/limit pagination; createdAt ASC, id ASC. Actor USER with UUID or SYSTEM with null.',
  })
  history(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.orders.history(req.identity!.sub, id, query);
  }

  @Post(':id/cancel')
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false, maxProperties: 0 },
  })
  @ApiResponse({
    status: 409,
    description: 'ORDER_NOT_ELIGIBLE / STOCK_RANGE_EXCEEDED; no second release',
  })
  @ApiResponse({ status: 200, schema: cancellationSchema })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
  @ApiResponse({ status: 403, description: 'CUSTOMER only' })
  @ApiResponse({ status: 404, description: 'Missing or foreign order' })
  @ApiResponse({ status: 400, description: 'VALIDATION_FAILED' })
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Cancel own pending reservation',
    description:
      'Missing/foreign404; nonpending or overdue409 ORDER_NOT_ELIGIBLE. Already CANCELLED200 changed:false. Atomic attempt expiry, release once and USER history; restoration overflow409 STOCK_RANGE_EXCEEDED rolls back.',
  })
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(EmptyBodyPipe) body: Record<string, never>,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void body;
    void query;
    return this.orders.cancel(req.identity!.sub, id);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'CUSTOMER atomic checkout and inventory reservation',
    description:
      '1-100 distinct UUIDv4 products, normalized before duplicate checks; integer quantity1..2147483647. Inline shipping required; no cart/address ID. Locks products in ascending ID, reloads price/active/stock, rejects any unavailable/overflow before writes. One transaction reserves stock and creates immutable snapshots plus initial SYSTEM history. Default reservation3600s from database time after locks, configurable via ORDER_RESERVATION_SECONDS. Generated line totals come from PostgreSQL. Items returned in productId ascending order. No payment initiation or idempotency-key API; each accepted call creates a new reservation.',
  })
  @ApiResponse({ status: 201, schema: checkoutSchema })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_FAILED / MONEY_LIMIT_EXCEEDED',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  @ApiResponse({
    status: 409,
    description: 'INSUFFICIENT_STOCK (missing/inactive/out of stock)',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN; CUSTOMER only' })
  @ApiResponse({
    status: 500,
    description: 'Safe INTERNAL_ERROR; transaction rolled back',
  })
  @ApiResponse({ status: 503, description: 'SERVICE_UNAVAILABLE' })
  checkout(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CheckoutDto,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void query;
    return this.orders.checkout(request.identity!.sub, dto);
  }
}
