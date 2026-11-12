import {
  Body,
  Controller,
  Header,
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
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from '../auth/access-token.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CheckoutDto } from './dto/checkout.dto';
import { OrdersService } from './orders.service';
import { checkoutSchema } from './orders.openapi';

@Controller('orders')
@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('CUSTOMER')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'CUSTOMER atomic checkout and inventory reservation',
    description:
      '1–100 distinct UUIDv4 products, normalized before duplicate checks; integer quantity1..2147483647. Inline shipping required; no cart/address ID. Locks products in ascending ID, reloads price/active/stock, rejects any unavailable/overflow before writes. One transaction reserves stock and creates immutable snapshots plus initial SYSTEM history. Default reservation3600s from database time after locks, configurable via ORDER_RESERVATION_SECONDS. Generated line totals come from PostgreSQL. Items returned in productId ascending order. No payment initiation or idempotency-key API; each accepted call creates a new reservation.',
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
