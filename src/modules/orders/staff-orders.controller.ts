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
@ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
@ApiResponse({ status: 403, description: 'STAFF/ADMIN only' })
@ApiResponse({
  status: 400,
  description: 'VALIDATION_FAILED; unknown/protected fields rejected',
})
@ApiResponse({ status: 503, description: 'SERVICE_UNAVAILABLE' })
export class StaffOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Shared STAFF/ADMIN fulfillment queue',
    description:
      'status PAID(default)/PROCESSING/SHIPPED/COMPLETED only. Fixed createdAt ASC,id ASC. offset0..1000000 default0; limit1..100 default20. Total uses same status filter; safe payment summaries, no shipping/items/customerId in queue.',
  })
  @ApiResponse({ status: 200, schema: orderListSchema })
  list(@Query() query: FulfillmentQueryDto) {
    return this.orders.fulfillmentQueue(query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Fulfillment detail with immutable lines, shipping, customerId and safe payment summaries',
  })
  @ApiResponse({ status: 200, schema: staffOrderDetailSchema })
  @ApiResponse({
    status: 404,
    description: 'Missing or outside PAID/PROCESSING/SHIPPED/COMPLETED scope',
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
    summary: 'Fulfillment history; same eligible scope as detail',
    description:
      'offset/limit pagination; fixed createdAt ASC,id ASC, USER/SYSTEM attribution.',
  })
  @ApiResponse({ status: 200, schema: historySchema })
  @ApiResponse({
    status: 404,
    description: 'Missing or outside fulfillment scope',
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
    summary: 'Advance one fulfillment edge atomically with USER history',
    description:
      'Only PAID->PROCESSING->SHIPPED->COMPLETED. Order then payments by ID locked; actor from JWT. Optional trimmed safe note1..1000 or null. No payment/stock writes. Repeated/skipped/backward/terminal transition409; pending/cancelled/expired/missing404.',
  })
  @ApiResponse({ status: 200, schema: orderSummarySchema })
  @ApiResponse({
    status: 404,
    description: 'Missing or outside fulfillment scope',
  })
  @ApiResponse({ status: 409, description: 'INVALID_STATE_TRANSITION' })
  @ApiResponse({
    status: 500,
    description: 'Safe INTERNAL_ERROR; order/history rolled back',
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
