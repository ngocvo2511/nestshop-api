import { Controller, Get, Header, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ContextRequest, ResponseMode } from '../../common/http/response-mode';
import { browserReturnSchema } from './reconciliation.openapi';
import { VnpayCallbackService } from './vnpay-callback.service';
const rawQuery = (req: ContextRequest) =>
  req.originalUrl.includes('?')
    ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1)
    : '';
@Controller('payments/vnpay')
@ApiTags('VNPay callbacks')
export class VnpayCallbackController {
  constructor(private readonly callbacks: VnpayCallbackService) {}
  @Get('ipn')
  @ResponseMode('provider')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Public signature-authenticated VNPay IPN; no JWT',
    description:
      'Bounded original-query parsing; reject duplicate/unknown/malformed fields. Order then payments locks; accepted SUCCESS/PAID/SYSTEM history/SETTLED receipt atomic, no stock deduction. Unresolved/late results only record receipts. Acknowledge after commit; DB/processing failure99 for retry. No common envelope.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Plain provider acknowledgement;00 handled,02 duplicate,01 unknown context,04 amount mismatch,97 invalid,99 processing failure',
    schema: {
      type: 'object',
      properties: {
        RspCode: { type: 'string', enum: ['00', '02', '01', '04', '97', '99'] },
        Message: { type: 'string' },
      },
    },
  })
  ipn(@Req() req: ContextRequest) {
    return this.callbacks.ipn(rawQuery(req), req.correlationId);
  }
  @Get('return')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Verified browser outcome only; never settles or reads stored order data',
    description:
      'Public signed minimal echo {reference,providerResponseCode,settlementAuthoritative:false}. No ownership access to stored order/shipping/payment; malformed/signature/merchant/currency invalid400.',
  })
  @ApiResponse({
    status: 200,
    description: 'Standard JSON envelope with minimal nonauthoritative outcome',
    schema: browserReturnSchema,
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_FAILED' })
  browserReturn(@Req() req: ContextRequest) {
    return this.callbacks.browserReturn(rawQuery(req));
  }
}
