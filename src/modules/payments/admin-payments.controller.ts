import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { EmptyBodyPipe } from '../../common/http/empty-body.pipe';
import { PaginationQueryDto } from '../../common/http/dto/pagination-query.dto';
import { PaymentQueryDto } from './dto/payment-query.dto';
import {
  adminPaymentSchema,
  adminPaymentsSchema,
  paymentReceiptsSchema,
} from './reconciliation.openapi';
import { PaymentReconciliationService } from './payment-reconciliation.service';

@Controller('admin/payments')
@ApiTags('payment reconciliation')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN')
@ApiResponse({
  status: 401,
  description: 'UNAUTHORIZED: Log in and provide a valid access token.',
})
@ApiResponse({
  status: 403,
  description: 'FORBIDDEN: Only ADMIN accounts can use this endpoint.',
})
@ApiResponse({
  status: 400,
  description:
    'VALIDATION_FAILED: Check the filters, IDs and pagination parameters.',
})
export class AdminPaymentsController {
  constructor(private readonly reconciliation: PaymentReconciliationService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List payments (ADMIN)',
    description:
      'Lists payment attempts for review. Filter by status, orderId or an exact providerReference. Newest attempts appear first; attempts created at the same time are ordered by ID, descending. Use offset and limit for pagination. total counts all matching attempts. This endpoint only reads payment records; it does not confirm payments or issue refunds.',
  })
  @ApiResponse({
    status: 200,
    description:
      'A page of payment records and the total number of matching records.',
    schema: adminPaymentsSchema,
  })
  list(@Query() query: PaymentQueryDto) {
    return this.reconciliation.list(query);
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'View payment details (ADMIN)' })
  @ApiResponse({
    status: 200,
    description:
      'Payment details. Does not include the payment link or secret credentials.',
    schema: adminPaymentSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'NOT_FOUND: The payment does not exist.',
  })
  detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void query;
    return this.reconciliation.detail(id);
  }
  @Get(':id/notifications')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'View received VNPay notifications (ADMIN)',
    description:
      'Lists IPN notifications linked to this payment, from oldest to newest. Notifications received at the same time are ordered by ID, ascending. Use offset and limit for pagination. Repeated notifications are listed separately. Unverified notifications that cannot be linked to a payment do not appear here. Raw callback data, signatures and secrets are not returned.',
  })
  @ApiResponse({
    status: 200,
    description:
      'A page of received notifications and the total number of matching records.',
    schema: paymentReceiptsSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'NOT_FOUND: The payment does not exist.',
  })
  notifications(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.reconciliation.notifications(id, query);
  }
}
