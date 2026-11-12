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
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Owner-only local VNPay Sandbox URL initiation',
    description:
      'No body or empty JSON object; no query fields. Locks order then payments by ID and rechecks DB wall time. Missing/foreign404; nonpending/overdue409. PENDING attempts always409 PAYMENT_UNRESOLVED until safe provider reuse is verified, even after local target expiry. Only genuine FAILED/EXPIRED predecessors allow replacement. Stored total only, VND decimal string <=9999999999; multiply100 exactly. New attempt201 with reused:false and signed URL. No provider HTTP call or callback settlement; default20-minute target independent of order deadline and not proof of finality. Socket peer IP used; forwarded IP headers ignored.',
  })
  @ApiResponse({ status: 201, schema: initiationSchema })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_FAILED / MONEY_LIMIT_EXCEEDED',
  })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
  @ApiResponse({ status: 403, description: 'CUSTOMER only' })
  @ApiResponse({ status: 404, description: 'Missing or foreign order' })
  @ApiResponse({
    status: 409,
    description: 'ORDER_NOT_ELIGIBLE / PAYMENT_UNRESOLVED',
  })
  @ApiResponse({
    status: 503,
    description:
      'PAYMENT_UNAVAILABLE (configuration/signing) / SERVICE_UNAVAILABLE',
  })
  @ApiResponse({
    status: 500,
    description: 'Safe INTERNAL_ERROR; persistence rolled back',
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
