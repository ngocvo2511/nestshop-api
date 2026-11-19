import {
  Body,
  Controller,
  Header,
  Param,
  ParseUUIDPipe,
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
import { PaymentsService } from './payments.service';
import { initiationSchema } from './payments.openapi';

@Controller('orders')
@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('CUSTOMER')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}
  @Post(':id/payment-attempts')
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false, maxProperties: 0 },
  })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Create a VNPay Sandbox payment link',
    description:
      'Creates a payment link for your unpaid order using the total saved by the server.\n\n- Send no body, or an empty JSON object, and no query parameters.\n- The order must belong to you and its reservation must still be valid.\n- Returns a new payment attempt and paymentUrl. Open paymentUrl in the browser to pay.\n- A payment link lasts 20 minutes by default, separately from the order reservation.\n- If an existing attempt is still PENDING, returns PAYMENT_UNRESOLVED, even if its expiresAt has passed. Only FAILED or EXPIRED attempts can be replaced.\n- Creating a link does not mark the order as paid. A valid VNPay IPN must confirm the payment.',
  })
  @ApiResponse({ status: 201, schema: initiationSchema })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED: Check the order ID and request format. MONEY_LIMIT_EXCEEDED: The amount exceeds the supported VNPay limit.',
  })
  @ApiResponse({
    status: 401,
    description: 'UNAUTHORIZED: Log in and provide a valid access token.',
  })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN: Only CUSTOMER accounts can create payment links.',
  })
  @ApiResponse({
    status: 404,
    description:
      'NOT_FOUND: The order does not exist or belongs to another customer.',
  })
  @ApiResponse({
    status: 409,
    description:
      'ORDER_NOT_ELIGIBLE: The order is no longer awaiting payment or its reservation has expired. PAYMENT_UNRESOLVED: An existing payment attempt is awaiting a final result.',
  })
  @ApiResponse({
    status: 503,
    description:
      'PAYMENT_UNAVAILABLE: VNPay is not configured or a payment link could not be generated. SERVICE_UNAVAILABLE: Try again later.',
  })
  @ApiResponse({
    status: 500,
    description:
      'INTERNAL_ERROR: The payment attempt could not be saved; no partial changes were saved.',
  })
  initiate(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(EmptyBodyPipe) body: Record<string, never>,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void body;
    void query;
    return this.payments.initiate(
      req.identity!.sub,
      id,
      req.socket.remoteAddress ?? '',
    );
  }
}
