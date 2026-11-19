import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { EmptyBodyPipe } from '../../common/http/empty-body.pipe';
import { PaginationQueryDto } from '../../common/http/dto/pagination-query.dto';
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from '../auth/access-token.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AdvanceOrderDto, FulfillmentQueryDto } from './dto/fulfillment.dto';
import { OrdersService } from './orders.service';
import {
  historySchema,
  orderListSchema,
  orderSummarySchema,
  staffOrderDetailSchema,
} from './orders.openapi';

@Controller('staff/orders')
@ApiTags('staff orders')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('STAFF', 'ADMIN')
@ApiResponse({
  status: 401,
  description: 'UNAUTHORIZED: Log in and provide a valid access token.',
})
@ApiResponse({
  status: 403,
  description:
    'FORBIDDEN: Only STAFF and ADMIN accounts can use this endpoint.',
})
@ApiResponse({
  status: 400,
  description:
    'VALIDATION_FAILED: Check the request fields. Unknown fields are not accepted.',
})
@ApiResponse({
  status: 503,
  description:
    'SERVICE_UNAVAILABLE: The service is temporarily unavailable. Try again later.',
})
export class StaffOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List orders to fulfill (STAFF, ADMIN)',
    description:
      'Lists orders ready for staff to handle.\n\n- Filter by status: PAID (paid, the default), PROCESSING (being prepared), SHIPPED (sent to the customer), or COMPLETED (finished).\n- Oldest orders appear first. Orders created at the same time are ordered by ID, ascending.\n- Use offset to skip records and limit to set the page size. The defaults are offset=0 and limit=20.\n- total is the number of orders matching the selected status, across all pages.\n- The list includes payment summaries. Open order details to see the customer ID, delivery details and items.',
  })
  @ApiResponse({ status: 200, schema: orderListSchema })
  list(@Query() query: FulfillmentQueryDto) {
    return this.orders.fulfillmentQueue(query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'View an order for fulfillment (STAFF, ADMIN)',
  })
  @ApiResponse({ status: 200, schema: staffOrderDetailSchema })
  @ApiResponse({
    status: 404,
    description:
      'NOT_FOUND: The order does not exist or is not PAID, PROCESSING, SHIPPED or COMPLETED.',
  })
  detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void query;
    return this.orders.fulfillmentDetail(id);
  }

  @Get(':id/history')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'View order status history (STAFF, ADMIN)',
    description:
      'Lists status changes from oldest to newest for orders that staff can handle. Changes made at the same time are ordered by ID, ascending. Use offset and limit for pagination. Each entry shows whether a user or the system made the change.',
  })
  @ApiResponse({ status: 200, schema: historySchema })
  @ApiResponse({
    status: 404,
    description:
      'NOT_FOUND: The order does not exist or is not available for fulfillment.',
  })
  history(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.orders.fulfillmentHistory(id, query);
  }

  @Post(':id/status')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Update order status (STAFF, ADMIN)',
    description:
      'Move the order forward by one step: PAID (paid) -> PROCESSING (being prepared) -> SHIPPED (sent) -> COMPLETED (finished). You cannot skip steps, go backwards or send the same status again; these requests return 409. You may include a note of 1 to 1000 characters, or null. Each change is saved in the order history. This endpoint does not change stock or payment records.',
  })
  @ApiResponse({ status: 200, schema: orderSummarySchema })
  @ApiResponse({
    status: 404,
    description:
      'NOT_FOUND: The order does not exist or is not available for fulfillment.',
  })
  @ApiResponse({
    status: 409,
    description:
      'INVALID_STATE_TRANSITION: Move forward by exactly one step; do not repeat or skip a status.',
  })
  @ApiResponse({
    status: 500,
    description:
      'INTERNAL_ERROR: The status could not be updated; no partial changes were saved.',
  })
  advance(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdvanceOrderDto,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void query;
    return this.orders.advanceStatus(req.identity!.sub, id, dto);
  }
}
