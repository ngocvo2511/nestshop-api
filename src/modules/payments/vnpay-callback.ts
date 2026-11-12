import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalQuery, providerTime } from './vnpay.adapter';

const limits: Record<string, number> = {
  vnp_TmnCode: 8,
  vnp_TxnRef: 100,
  vnp_Amount: 12,
  vnp_ResponseCode: 2,
  vnp_TransactionStatus: 2,
  vnp_TransactionNo: 15,
  vnp_PayDate: 14,
  vnp_BankCode: 20,
  vnp_BankTranNo: 255,
  vnp_CardType: 20,
  vnp_OrderInfo: 255,
  vnp_CurrCode: 3,
  vnp_SecureHash: 128,
};
export type CallbackFields = Record<string, string>;
export type CallbackVerification =
  { valid: true; fields: CallbackFields } | { valid: false };
/** Parse the original query, not Express's lossy/simplified query object. Never log it. */
export function verifyCallback(
  raw: string,
  secret: string,
): CallbackVerification {
  try {
    if (!raw || raw.length > 8192) return { valid: false };
    const pairs = raw.split('&');
    if (pairs.length > 16) return { valid: false };
    const fields: CallbackFields = Object.create(null) as CallbackFields;
    for (const pair of pairs) {
      const index = pair.indexOf('=');
      if (index < 1) return { valid: false };
      const decode = (value: string) =>
        decodeURIComponent(value.replace(/\+/g, ' '));
      const key = decode(pair.slice(0, index)),
        value = decode(pair.slice(index + 1));
      if (
        !Object.hasOwn(limits, key) ||
        Object.hasOwn(fields, key) ||
        Array.from(value).length > limits[key] ||
        /\p{Cc}/u.test(value)
      )
        return { valid: false };
      fields[key] = value;
    }
    if (!/^[a-fA-F0-9]{128}$/.test(fields.vnp_SecureHash ?? ''))
      return { valid: false };
    const hash = fields.vnp_SecureHash;
    delete fields.vnp_SecureHash;
    const expected = createHmac('sha512', secret)
      .update(canonicalQuery(fields), 'utf8')
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(hash, 'hex')))
      return { valid: false };
    const matches = (key: string, re: RegExp) => re.test(fields[key] ?? '');
    if (
      !matches('vnp_TmnCode', /^[A-Za-z0-9]{8}$/) ||
      !matches('vnp_TxnRef', /^[A-Za-z0-9]{1,100}$/) ||
      !matches('vnp_Amount', /^[1-9][0-9]{0,11}$/) ||
      !matches('vnp_ResponseCode', /^[0-9]{2}$/) ||
      !matches('vnp_TransactionStatus', /^[0-9]{2}$/) ||
      !matches('vnp_TransactionNo', /^[0-9]{1,15}$/) ||
      !fields.vnp_OrderInfo
    )
      return { valid: false };
    for (const key of ['vnp_BankCode', 'vnp_BankTranNo', 'vnp_CardType'])
      if (fields[key] && !/^[A-Za-z0-9]+$/.test(fields[key]))
        return { valid: false };
    if (
      fields.vnp_CurrCode !== undefined &&
      !/^[A-Z]{3}$/.test(fields.vnp_CurrCode)
    )
      return { valid: false };
    if (fields.vnp_PayDate !== undefined && !callbackDate(fields.vnp_PayDate))
      return { valid: false };
    return { valid: true, fields };
  } catch {
    return { valid: false };
  }
}
export function callbackDate(value: string): Date | null {
  if (!/^[0-9]{14}$/.test(value)) return null;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+07:00`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) &&
    providerTime(date, 'Asia/Ho_Chi_Minh') === value
    ? date
    : null;
}
export function callbackResult(
  fields: CallbackFields,
): 'SUCCESS' | 'FAILED' | 'UNRESOLVED' {
  if (
    fields.vnp_ResponseCode === '00' &&
    fields.vnp_TransactionStatus === '00' &&
    /^[A-Za-z0-9]{3,20}$/.test(fields.vnp_BankCode ?? '') &&
    /^[1-9][0-9]{0,14}$/.test(fields.vnp_TransactionNo)
  )
    return 'SUCCESS';
  const failures = [
    '09',
    '10',
    '11',
    '12',
    '13',
    '24',
    '51',
    '65',
    '75',
    '79',
    '99',
  ];
  return fields.vnp_TransactionStatus === '02' &&
    failures.includes(fields.vnp_ResponseCode)
    ? 'FAILED'
    : 'UNRESOLVED';
}
export const acknowledgements = {
  handled: { RspCode: '00', Message: 'Handled' },
  duplicate: { RspCode: '02', Message: 'Already confirmed' },
  unknown: { RspCode: '01', Message: 'Unknown reference' },
  mismatch: { RspCode: '04', Message: 'Amount mismatch' },
  invalid: { RspCode: '97', Message: 'Invalid signature' },
} as const;
