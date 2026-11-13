import { applyDecorators, Controller, Get, Header, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';
import { ContextRequest, ResponseMode } from '../../common/http/response-mode';
import { browserReturnSchema } from './reconciliation.openapi';
import { VnpayCallbackService } from './vnpay-callback.service';
const rawQuery = (req: ContextRequest) =>
  req.originalUrl.includes('?')
    ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1)
    : '';
function CallbackQueries() {
  const fields: Array<[string, number, boolean, string?]> = [
    ['vnp_TmnCode', 8, true],
    ['vnp_TxnRef', 100, true],
    [
      'vnp_Amount',
      12,
      true,
      'Whole VND multiplied by100; positive integer digit string.',
    ],
    ['vnp_OrderInfo', 255, true],
    ['vnp_ResponseCode', 2, true],
    ['vnp_TransactionStatus', 2, true],
    ['vnp_TransactionNo', 15, true],
    [
      'vnp_SecureHash',
      128,
      true,
      'HMAC-SHA512 hex signature; never log or persist raw query/signature.',
    ],
    [
      'vnp_PayDate',
      14,
      false,
      'yyyyMMddHHmmss GMT+7; validated when supplied.',
    ],
    ['vnp_BankCode', 20, false],
    ['vnp_BankTranNo', 255, false],
    ['vnp_CardType', 20, false],
    ['vnp_CurrCode', 3, false, 'VND when supplied.'],
  ];
  return applyDecorators(
    ...fields.map(([name, maxLength, required, description]) =>
      ApiQuery({
        name,
        required,
        description:
          description ??
          'Provider-signed field; original query decoded once; duplicates/unknown fields reject.',
        schema: { type: 'string', maxLength },
      }),
    ),
  );
}
@Controller('payments/vnpay')
@ApiTags('VNPay callbacks')
export class VnpayCallbackController {
  constructor(private readonly callbacks: VnpayCallbackService) {}
  @Get('ipn')
  @CallbackQueries()
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
  @CallbackQueries()
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
