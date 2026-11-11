import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Configuration } from '../../config/configuration';
import { vnpayConfig } from '../../config/vnpay.config';
import {
  canonicalQuery,
  providerAmount,
  providerTime,
  VnpayAdapter,
} from './vnpay.adapter';
const fixtures = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../test/fixtures/vnpay-signing.json'),
    'utf8',
  ),
) as {
  key: string;
  full: {
    fields: Record<string, string>;
    canonical: string;
    signature: string;
  };
  encoding: {
    fields: Record<string, string>;
    canonical: string;
    signature: string;
  };
};
const settings = () =>
  vnpayConfig({
    VNPAY_MODE: 'sandbox',
    VNPAY_TMN_CODE: 'FIXT0001',
    VNPAY_HASH_SECRET: fixtures.key,
    VNPAY_RETURN_URL: 'https://merchant.invalid/return',
    VNPAY_IPN_URL: 'https://merchant.invalid/ipn',
  });
const config = () =>
  new ConfigService<Configuration, true>({ vnpay: settings() });
const input = {
  reference: '0123456789abcdef0123456789abcdef',
  amountVnd: '10000',
  createdAt: new Date('2026-11-11T16:59:59Z'),
  expiresAt: new Date('2026-11-11T17:19:59Z'),
  ipAddress: '::ffff:127.0.0.1',
};
describe('VNPay 2.1.0 independent frozen Python vectors', () => {
  it.each(['full', 'encoding'] as const)(
    '%s canonical bytes and HMAC match independently frozen expected literals',
    (name) => {
      const vector = fixtures[name];
      expect(canonicalQuery(vector.fields)).toBe(vector.canonical);
      expect(
        createHmac('sha512', fixtures.key)
          .update(vector.canonical, 'utf8')
          .digest('hex'),
      ).toBe(vector.signature);
    },
  );
  it('adapter emits exactly the frozen request/signature, omits optional bank/hash-type/IPN fields and never includes the secret', () => {
    const url = new VnpayAdapter(config()).create(input);
    expect(url).toBe(
      'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?' +
        fixtures.full.canonical +
        '&vnp_SecureHash=' +
        fixtures.full.signature,
    );
    expect(url).not.toContain(fixtures.key);
    expect(url).not.toMatch(/vnp_BankCode|vnp_SecureHashType|vnp_IpnUrl/);
  });
  it.each([
    ['1', '100'],
    ['10000', '1000000'],
    ['9999999999', '999999999900'],
  ])('amount %s converts exactly to %s', (value, expected) =>
    expect(providerAmount(value)).toBe(expected),
  );
  it.each([
    '0',
    '-1',
    '01',
    '1.5',
    '1e3',
    '10000000000',
    '9007199254740993',
    '9223372036854775807',
  ])('rejects invalid/provider-overflow amount %s', (value) =>
    expect(() => providerAmount(value)).toThrow('Amount exceeds'),
  );
  it.each([
    ['2026-11-11T17:00:00Z', '20261112000000'],
    ['2026-12-31T17:00:00Z', '20270101000000'],
    ['2024-02-28T17:00:00Z', '20240229000000'],
  ])('GMT+7 date %s -> %s regardless of host timezone', (date, expected) => {
    const previous = process.env.TZ;
    try {
      for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
        process.env.TZ = tz;
        expect(providerTime(new Date(date), 'Asia/Ho_Chi_Minh')).toBe(expected);
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
  it('uses configured locale and rejects unconfigured mode, invalid IP/reference/deadline', () => {
    const en = new ConfigService<Configuration, true>({
      vnpay: { ...settings(), locale: 'en' },
    });
    expect(
      new URL(new VnpayAdapter(en).create(input)).searchParams.get(
        'vnp_Locale',
      ),
    ).toBe('en');
    expect(() =>
      new VnpayAdapter(
        new ConfigService<Configuration, true>({ vnpay: vnpayConfig({}) }),
      ).create(input),
    ).toThrow('unavailable');
    for (const patch of [
      { ipAddress: 'client.invalid' },
      { reference: 'bad&reference' },
      { expiresAt: input.createdAt },
    ])
      expect(() =>
        new VnpayAdapter(config()).create({ ...input, ...patch }),
      ).toThrow('unavailable');
  });
});
