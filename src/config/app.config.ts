import { choice, Environment, integer, text } from './environment';

export function appConfig(env: Environment) {
  return {
    environment: choice(
      env,
      'NODE_ENV',
      ['development', 'test', 'production'] as const,
      'development',
    ),
    host: text(env, 'HOST', '127.0.0.1'),
    port: integer(env, 'PORT', '3000', 65535),
  };
}
