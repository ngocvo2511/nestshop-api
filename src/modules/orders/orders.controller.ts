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
  @ApiResponse({
    status: 401,
    description: 'UNAUTHORIZED: Log in and provide a valid access token.',
  })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN: Only CUSTOMER accounts can use this endpoint.',
  })
  @ApiResponse({
    status: 404,
    description:
      'NOT_FOUND: The order does not exist or belongs to another customer.',
  })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED: Check the request fields and their formats.',
  })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List my orders',
    description:
      'Lists only your own orders. You can filter by status. Newest orders appear first by default; use sort=createdAt for oldest first or sort=-createdAt for newest first. Orders created at the same time are ordered by ID in the same direction. Use offset and limit for pagination. Each order includes a payment summary.',
  })
  list(@Req() req: AuthenticatedRequest, @Query() query: OrderQueryDto) {
    return this.orders.list(req.identity!.sub, query);
  }

  @Get(':id')
  @ApiResponse({ status: 200, schema: orderDetailSchema })
  @ApiResponse({
    status: 401,
    description: 'UNAUTHORIZED: Log in and provide a valid access token.',
  })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN: Only CUSTOMER accounts can use this endpoint.',
  })
  @ApiResponse({
    status: 404,
    description:
      'NOT_FOUND: The order does not exist or belongs to another customer.',
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_FAILED: Check the order ID and request fields.',
  })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'View my order details',
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
  @ApiResponse({
    status: 401,
    description: 'UNAUTHORIZED: Log in and provide a valid access token.',
  })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN: Only CUSTOMER accounts can use this endpoint.',
  })
  @ApiResponse({
    status: 404,
    description:
      'NOT_FOUND: The order does not exist or belongs to another customer.',
  })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED: Check the order ID and pagination parameters.',
  })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'View my order status history',
    description:
      'Lists status changes for your order, from oldest to newest. Changes made at the same time are ordered by ID, ascending. Use offset and limit for pagination. USER means a person made the change; SYSTEM means it was automatic.',
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
    description:
      'ORDER_NOT_ELIGIBLE: The order can no longer be cancelled. STOCK_RANGE_EXCEEDED: Stock could not be restored; nothing was changed.',
  })
  @ApiResponse({ status: 200, schema: cancellationSchema })
  @ApiResponse({
    status: 401,
    description: 'UNAUTHORIZED: Log in and provide a valid access token.',
  })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN: Only CUSTOMER accounts can use this endpoint.',
  })
  @ApiResponse({
    status: 404,
    description:
      'NOT_FOUND: The order does not exist or belongs to another customer.',
  })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED: Send no body, or an empty JSON object, and no query parameters.',
  })
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Cancel my unpaid order',
    description:
      'Cancels your order while it is awaiting payment and the reservation has not expired. Restores the reserved stock and closes pending payment attempts. If already cancelled, returns changed=false without restoring stock again. Paid orders and overdue reservations cannot be cancelled here. Send no body, or an empty JSON object, and no query parameters.',
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
    summary: 'Place an order',
    description:
      'Send 1 to 100 different products, the quantity for each, and delivery details. The server checks current prices and stock, calculates the total, and reserves the items. Stock is reserved for 1 hour by default (ORDER_RESERVATION_SECONDS). Product names, prices and delivery details are saved with the order. Returned items are ordered by product ID. This endpoint does not start payment; use the payment-attempts endpoint next. Sending the request again creates another order.',
  })
  @ApiResponse({ status: 201, schema: checkoutSchema })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED: Check products, quantities and delivery details. MONEY_LIMIT_EXCEEDED: The order amount is too large.',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  @ApiResponse({
    status: 409,
    description:
      'INSUFFICIENT_STOCK: A product is missing, no longer on sale, or has insufficient stock.',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  @ApiResponse({
    status: 401,
    description: 'UNAUTHORIZED: Log in and provide a valid access token.',
  })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN: Only CUSTOMER accounts can place orders.',
  })
  @ApiResponse({
    status: 500,
    description:
      'INTERNAL_ERROR: The order could not be created; no partial changes were saved.',
  })
  @ApiResponse({
    status: 503,
    description:
      'SERVICE_UNAVAILABLE: The service is temporarily unavailable. Try again later.',
  })
  checkout(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CheckoutDto,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void query;
    return this.orders.checkout(request.identity!.sub, dto);
  }
}
