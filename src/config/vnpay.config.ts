import { choice, Environment, secret, text, url } from './environment';

export function vnpayConfig(env: Environment) {
  const mode = choice(
    env,
    'VNPAY_MODE',
    ['unconfigured', 'sandbox'] as const,
    'unconfigured',
  );
  const apiVersion = choice(
    env,
    'VNPAY_API_VERSION',
    ['2.1.0'] as const,
    '2.1.0',
  );
  const common = {
    apiVersion,
    timezone: choice(
      env,
      'VNPAY_TIMEZONE',
      ['Asia/Ho_Chi_Minh'] as const,
      'Asia/Ho_Chi_Minh',
    ),
    locale: choice(env, 'VNPAY_LOCALE', ['vn', 'en'] as const, 'vn'),
    paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  } as const;
  if (mode === 'unconfigured') {
    const supplied = [
      'VNPAY_TMN_CODE',
      'VNPAY_HASH_SECRET',
      'VNPAY_RETURN_URL',
      'VNPAY_IPN_URL',
    ].some((key) => env[key] !== undefined && env[key] !== '');
    if (supplied)
      throw new Error(
        'Invalid environment: VNPAY_MODE=unconfigured requires empty merchant/callback settings',
      );
    return { ...common, mode, status: 'unconfigured' as const };
  }
  const tmnCode = text(env, 'VNPAY_TMN_CODE');
  if (!/^[a-zA-Z0-9]{8}$/.test(tmnCode))
    throw new Error(
      'Invalid environment: VNPAY_TMN_CODE must contain 8 alphanumeric characters',
    );
  const returnUrl = url(env, 'VNPAY_RETURN_URL', true);
  if (returnUrl.length > 255)
    throw new Error(
      'Invalid environment: VNPAY_RETURN_URL exceeds 255 characters',
    );
  return {
    ...common,
    mode,
    status: 'sandbox-configured' as const,
    tmnCode,
    hashSecret: secret(env, 'VNPAY_HASH_SECRET'),
    returnUrl,
    ipnUrl: url(env, 'VNPAY_IPN_URL'),
  };
}
