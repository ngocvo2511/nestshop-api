import { Environment, integer } from './environment';

export function expiryConfig(env: Environment) {
  const orderReservationSeconds = integer(
    env,
    'ORDER_RESERVATION_SECONDS',
    '3600',
  );
  const paymentAttemptSeconds = integer(env, 'PAYMENT_ATTEMPT_SECONDS', '1200');
  return {
    orderReservationSeconds,
    paymentAttemptSeconds,
    batchSize: integer(env, 'EXPIRY_SCAN_BATCH_SIZE', '100', 1000),
    scanIntervalSeconds: integer(
      env,
      'EXPIRY_SCAN_INTERVAL_SECONDS',
      '60',
      86400,
    ),
  };
}
