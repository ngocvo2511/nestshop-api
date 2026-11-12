import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { callbackDate, callbackResult, verifyCallback } from './vnpay-callback';
const f = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../test/fixtures/vnpay-callback.json'),
    'utf8',
  ),
) as {
  key: string;
  fields: Record<string, string>;
  query: string;
  encoding: { fields: Record<string, string>; query: string };
};
function signed(fields: Record<string, string>) {
  const params = new URLSearchParams(
    Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  const data = params.toString();
  return (
    data +
    '&vnp_SecureHash=' +
    createHmac('sha512', f.key).update(data).digest('hex')
  );
}
describe('VNPay bounded callback verification independent frozen Python oracle', () => {
  it('accepts independent signature without a currency/optional bank transaction/card field', () =>
    expect(verifyCallback(f.query, f.key)).toEqual({
      valid: true,
      fields: f.fields,
    }));
  it('verifies independent UTF-8/plus/percent/punctuation canonical bytes without double decoding', () => {
    expect(verifyCallback(f.encoding.query, f.key)).toEqual({
      valid: true,
      fields: f.encoding.fields,
    });
    expect(
      verifyCallback(f.encoding.query.replace('%2B', '+'), f.key).valid,
    ).toBe(false);
  });
  it('accepts equivalent escaped spaces and key ordering without changing signing semantics', () => {
    expect(verifyCallback(f.query.replace(/\+/g, '%20'), f.key).valid).toBe(
      true,
    );
    expect(
      verifyCallback(f.query.split('&').reverse().join('&'), f.key).valid,
    ).toBe(true);
  });
  it.each([
    '&vnp_Amount=1000000',
    '&%76np_Amount=1000000',
    '&vnp_SecureHash=abc',
    '&unknown=value',
    '&vnp_TxnRef[]=abc',
    '&vnp_OrderInfo=%GG',
    '&vnp_OrderInfo=%C0%AF',
    '&vnp_BankCode=%00',
    '&missingEquals',
  ])('rejects ambiguous/malformed suffix %s', (suffix) =>
    expect(verifyCallback(f.query + suffix, f.key).valid).toBe(false),
  );
  it('rejects wrong key, altered amount, oversized query and legacy hash-type field', () => {
    expect(verifyCallback(f.query, 'wrong-key').valid).toBe(false);
    expect(
      verifyCallback(f.query.replace('1000000', '1000100'), f.key).valid,
    ).toBe(false);
    expect(verifyCallback('a'.repeat(8193), f.key).valid).toBe(false);
    expect(
      verifyCallback(f.query + '&vnp_SecureHashType=SHA512', f.key).valid,
    ).toBe(false);
  });
  it.each<Record<string, string>>([
    { vnp_Amount: '1.5' },
    { vnp_Amount: '1000000000000' },
    { vnp_PayDate: '20260230000000' },
    { vnp_ResponseCode: '000' },
    { vnp_TransactionNo: 'x' },
    { vnp_TxnRef: 'x&y' },
    { vnp_TransactionStatus: '' },
  ])('rejects signed malformed required/optional data %j', (patch) =>
    expect(verifyCallback(signed({ ...f.fields, ...patch }), f.key).valid).toBe(
      false,
    ),
  );
  it('validates Gregorian GMT+7 dates', () => {
    expect(callbackDate('20240229000000')?.toISOString()).toBe(
      '2024-02-28T17:00:00.000Z',
    );
    expect(callbackDate('20260229000000')).toBeNull();
    expect(callbackDate('20261112240000')).toBeNull();
  });
  it.each([
    ['00', '00', 'SUCCESS'],
    ['24', '02', 'FAILED'],
    ['07', '07', 'UNRESOLVED'],
    ['00', '01', 'UNRESOLVED'],
    ['00', '02', 'UNRESOLVED'],
    ['99', '04', 'UNRESOLVED'],
    ['99', '99', 'UNRESOLVED'],
  ])('result %s/%s -> %s', (response, status, expected) =>
    expect(
      callbackResult({
        ...f.fields,
        vnp_ResponseCode: response,
        vnp_TransactionStatus: status,
      }),
    ).toBe(expected),
  );
});
