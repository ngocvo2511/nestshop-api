import { randomBytes } from 'node:crypto';
import { validateEnvironment } from './configuration';
import { Environment } from './environment';

function baseline(): Environment {
  return {
    DB_PASSWORD: randomBytes(24).toString('hex'),
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  };
}

describe('validated environment', () => {
  it('allows foundation startup without VNPay and exposes typed namespaces', () => {
    const config = validateEnvironment(baseline());
    expect(config.app.port).toBe(3000);
    expect(config.db.synchronize).toBe(false);
    expect(config.vnpay.status).toBe('unconfigured');
    expect(config.vnpay).not.toHaveProperty('hashSecret');
    expect(config.expiry).toMatchObject({
      orderReservationSeconds: 3600,
      paymentAttemptSeconds: 1200,
    });
  });

  it.each(['DB_PASSWORD', 'JWT_ACCESS_SECRET'])(
    'requires %s without leaking its value',
    (key) => {
      const env = baseline();
      delete env[key];
      expect(() => validateEnvironment(env)).toThrow(key);
      const invalidSecret = 'change-me-sensitive';
      env[key] = invalidSecret;
      expect(() => validateEnvironment(env)).toThrow(key);
      try {
        validateEnvironment(env);
        throw new Error('Expected rejection');
      } catch (error) {
        expect((error as Error).message).not.toContain(invalidSecret);
      }
    },
  );

  it('rejects a short JWT key', () => {
    expect(() =>
      validateEnvironment({ ...baseline(), JWT_ACCESS_SECRET: 'a'.repeat(31) }),
    ).toThrow('JWT_ACCESS_SECRET');
  });

  it.each([
    ['PORT', '0'],
    ['PORT', '65536'],
    ['PORT', '3000abc'],
    ['PORT', '3e3'],
    ['DB_PORT', '5432.5'],
    ['JWT_ACCESS_TTL_SECONDS', '-1'],
    ['JWT_REFRESH_TTL_SECONDS', '900'],
    ['JWT_REFRESH_TTL_SECONDS', 'Infinity'],
    ['UPLOAD_MAX_BYTES', '5242881'],
    ['EXPIRY_SCAN_INTERVAL_SECONDS', 'NaN'],
    ['ORDER_RESERVATION_SECONDS', '2147483648'],
    ['PAYMENT_ATTEMPT_SECONDS', '0'],
    ['NODE_ENV', 'staging'],
    ['VNPAY_MODE', 'production'],
    ['VNPAY_API_VERSION', '2.0.0'],
    ['JWT_ISSUER', ''],
    ['JWT_AUDIENCE', ' '],
    ['UPLOAD_DIRECTORY', ' '],
    ['HOST', ' localhost '],
    ['HOST', 'local\nhost'],
  ])('rejects invalid %s', (key, value) => {
    expect(() => validateEnvironment({ ...baseline(), [key]: value })).toThrow(
      key,
    );
  });

  it('keeps the order reservation and provider attempt target independently configurable', () => {
    const config = validateEnvironment({
      ...baseline(),
      ORDER_RESERVATION_SECONDS: '600',
      PAYMENT_ATTEMPT_SECONDS: '1200',
    });
    expect(config.expiry).toMatchObject({
      orderReservationSeconds: 600,
      paymentAttemptSeconds: 1200,
    });
  });

  it('allows database-free scaffold tests only in an explicit test environment', () => {
    expect(
      validateEnvironment({
        ...baseline(),
        NODE_ENV: 'test',
        DB_ENABLED: 'false',
      }).db.enabled,
    ).toBe(false);
    expect(() =>
      validateEnvironment({ ...baseline(), DB_ENABLED: 'false' }),
    ).toThrow('DB_ENABLED');
    expect(() =>
      validateEnvironment({
        ...baseline(),
        NODE_ENV: 'production',
        DB_ENABLED: 'false',
      }),
    ).toThrow('DB_ENABLED');
    expect(() =>
      validateEnvironment({ ...baseline(), DB_ENABLED: 'yes' }),
    ).toThrow('DB_ENABLED');
  });

  it('does not silently ignore partially supplied VNPay configuration', () => {
    expect(() =>
      validateEnvironment({ ...baseline(), VNPAY_TMN_CODE: 'ABCD1234' }),
    ).toThrow('VNPAY_MODE');
    expect(() =>
      validateEnvironment({ ...baseline(), VNPAY_MODE: 'sandbox' }),
    ).toThrow('VNPAY_TMN_CODE');
  });

  function sandbox(): Environment {
    return {
      ...baseline(),
      VNPAY_MODE: 'sandbox',
      VNPAY_TMN_CODE: 'ABCD1234',
      VNPAY_HASH_SECRET: randomBytes(32).toString('hex'),
      VNPAY_RETURN_URL: 'http://localhost:3000/api/v1/payments/vnpay/return',
      VNPAY_IPN_URL: 'https://merchant.example/api/v1/payments/vnpay/ipn',
    };
  }

  it('validates sandbox configuration without claiming provider verification', () => {
    const config = validateEnvironment(sandbox());
    expect(config.vnpay.status).toBe('sandbox-configured');
    expect(config.vnpay.apiVersion).toBe('2.1.0');
  });

  it.each([
    ['VNPAY_IPN_URL', 'http://localhost:3000/ipn'],
    ['VNPAY_RETURN_URL', 'http://public.example/return'],
    ['VNPAY_RETURN_URL', 'not-a-url'],
    ['VNPAY_RETURN_URL', 'https://user:password@example.com/return'],
    ['VNPAY_IPN_URL', 'https://example.com/ipn?secret=bad'],
    ['VNPAY_TMN_CODE', 'invalid-code'],
    ['VNPAY_HASH_SECRET', ''],
  ])('rejects unsafe or incomplete sandbox %s', (key, value) => {
    expect(() => validateEnvironment({ ...sandbox(), [key]: value })).toThrow(
      key,
    );
  });
});
