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
@ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
@ApiResponse({ status: 403, description: 'ADMIN only' })
@ApiResponse({ status: 400, description: 'VALIDATION_FAILED' })
export class AdminPaymentsController {
  constructor(private readonly reconciliation: PaymentReconciliationService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Read-only Admin payment inspection',
    description:
      'offset0..1000000,limit1..100 default20. Optional status/orderId/exact ASCII providerReference. Fixed createdAt DESC,id DESC; total uses same filter. Safe canonical metadata only, no signed URL/credentials. No manual-settlement/refund mutation.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated AdminPayment summaries',
    schema: adminPaymentsSchema,
  })
  list(@Query() query: PaymentQueryDto) {
    return this.reconciliation.list(query);
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read-only canonical AdminPayment; no signed URL' })
  @ApiResponse({
    status: 200,
    description: 'AdminPayment',
    schema: adminPaymentSchema,
  })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
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
    summary:
      'Bounded safe payment receipts; duplicate observations remain distinct',
    description:
      'offset/limit pagination, fixed receivedAt ASC,id ASC. No raw callbacks, signatures, URLs or secrets stored/returned. Missing payment404. Invalid/unknown callbacks with no trusted payment association remain unlinked in storage.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated PaymentReceipt',
    schema: paymentReceiptsSchema,
  })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  notifications(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.reconciliation.notifications(id, query);
  }
}
