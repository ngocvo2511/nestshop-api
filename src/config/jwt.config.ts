import { Environment, integer, secret, text } from './environment';

export function jwtConfig(env: Environment) {
  const accessTtlSeconds = integer(env, 'JWT_ACCESS_TTL_SECONDS', '900');
  const refreshTtlSeconds = integer(env, 'JWT_REFRESH_TTL_SECONDS', '604800');
  if (refreshTtlSeconds <= accessTtlSeconds)
    throw new Error(
      'Invalid environment: JWT_REFRESH_TTL_SECONDS must exceed JWT_ACCESS_TTL_SECONDS',
    );
  return {
    accessSecret: secret(env, 'JWT_ACCESS_SECRET', 32),
    issuer: text(env, 'JWT_ISSUER', 'nestshop-api'),
    audience: text(env, 'JWT_AUDIENCE', 'nestshop-clients'),
    accessTtlSeconds,
    refreshTtlSeconds,
  };
}
