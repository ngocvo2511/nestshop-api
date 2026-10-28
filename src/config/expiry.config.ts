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
    scanIntervalSeconds: integer(env, 'EXPIRY_SCAN_INTERVAL_SECONDS', '60'),
  };
}
