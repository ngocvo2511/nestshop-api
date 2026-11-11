import { choice, Environment, integer, secret, text } from './environment';

export function databaseConfig(env: Environment) {
  const enabled =
    choice(env, 'DB_ENABLED', ['true', 'false'] as const, 'true') === 'true';
  if (!enabled && env.NODE_ENV !== 'test')
    throw new Error(
      'Invalid environment: DB_ENABLED=false is permitted only in NODE_ENV=test',
    );
  return {
    enabled,
    type: 'postgres' as const,
    host: text(env, 'DB_HOST', '127.0.0.1'),
    port: integer(env, 'DB_PORT', '5432', 65535),
    username: text(env, 'DB_USERNAME', 'shop'),
    password: secret(env, 'DB_PASSWORD'),
    database: text(env, 'DB_DATABASE', 'shop'),
    synchronize: false as const,
    logging: false as const,
  };
}
