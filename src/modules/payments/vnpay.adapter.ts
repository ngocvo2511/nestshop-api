import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { ApiError } from '../../common/http/api-error';
import { isVndAmount } from '../../common/validation/contract-validators';
import { Configuration } from '../../config/configuration';

// Match the official Node 2.1.0 sample: encode once, spaces as +, sorted ASCII keys.
export function canonicalQuery(fields: Readonly<Record<string, string>>) {
  const encode = (value: string) =>
    encodeURIComponent(value).replace(/%20/g, '+');
  return Object.keys(fields)
    .sort()
    .map((key) => `${encode(key)}=${encode(fields[key])}`)
    .join('&');
}
export function providerAmount(amountVnd: string) {
  if (!isVndAmount(amountVnd) || BigInt(amountVnd) > 9999999999n)
    throw new ApiError('MONEY_LIMIT_EXCEEDED');
  return (BigInt(amountVnd) * 100n).toString();
}
export function providerTime(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return ['year', 'month', 'day', 'hour', 'minute', 'second']
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join('');
}
export interface PaymentRequest {
  reference: string;
  amountVnd: string;
  createdAt: Date;
  expiresAt: Date;
  ipAddress: string;
}
@Injectable()
export class VnpayAdapter {
  constructor(private readonly config: ConfigService<Configuration, true>) {}
  create(input: PaymentRequest): string {
    const settings = this.config.get('vnpay', { infer: true });
    if (settings.mode !== 'sandbox') throw new ApiError('PAYMENT_UNAVAILABLE');
    const ip = input.ipAddress.startsWith('::ffff:')
      ? input.ipAddress.slice(7)
      : input.ipAddress;
    if (
      !isIP(ip) ||
      !/^[a-zA-Z0-9]{1,100}$/.test(input.reference) ||
      input.expiresAt <= input.createdAt
    )
      throw new ApiError('PAYMENT_UNAVAILABLE');
    const fields = {
      vnp_Version: settings.apiVersion,
      vnp_Command: 'pay',
      vnp_TmnCode: settings.tmnCode,
      vnp_Amount: providerAmount(input.amountVnd),
      vnp_CurrCode: 'VND',
      vnp_TxnRef: input.reference,
      vnp_OrderInfo: `Thanh toan don hang ${input.reference}`,
      vnp_OrderType: 'other',
      vnp_ReturnUrl: settings.returnUrl,
      vnp_IpAddr: ip,
      vnp_Locale: settings.locale,
      vnp_CreateDate: providerTime(input.createdAt, settings.timezone),
      vnp_ExpireDate: providerTime(input.expiresAt, settings.timezone),
    };
    const data = canonicalQuery(fields);
    const hash = createHmac('sha512', settings.hashSecret)
      .update(data, 'utf8')
      .digest('hex');
    // IPN URL is registered with the merchant, not an undocumented request parameter.
    return `${settings.paymentUrl}?${data}&vnp_SecureHash=${hash}`;
  }
}
