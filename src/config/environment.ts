export type Environment = Record<string, unknown>;

export function text(env: Environment, key: string, fallback?: string): string {
  const value = env[key] ?? fallback;
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    /\p{Cc}/u.test(value)
  ) {
    throw new Error(
      `Invalid environment: ${key} must be a nonempty string without surrounding whitespace or control characters`,
    );
  }
  return value;
}

export function integer(
  env: Environment,
  key: string,
  fallback: string,
  max = 2147483647,
): number {
  const value = text(env, key, fallback);
  if (
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > max
  ) {
    throw new Error(
      `Invalid environment: ${key} must be an integer between 1 and ${max}`,
    );
  }
  return Number(value);
}

export function choice<T extends string>(
  env: Environment,
  key: string,
  values: readonly T[],
  fallback: T,
): T {
  const value = text(env, key, fallback);
  if (!values.includes(value as T))
    throw new Error(`Invalid environment: ${key} has an unsupported value`);
  return value as T;
}

export function secret(env: Environment, key: string, min = 1): string {
  const value = text(env, key);
  if (
    value.length < min ||
    /^(change[-_ ]?me|replace|example|secret|password)/i.test(value)
  ) {
    throw new Error(
      `Invalid environment: ${key} requires a locally configured secret (minimum ${min} characters)`,
    );
  }
  return value;
}

export function url(env: Environment, key: string, localHttp = false): string {
  const value = text(env, key);
  try {
    const parsed = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(
      parsed.hostname,
    );
    if (
      (parsed.protocol !== 'https:' &&
        !(localHttp && loopback && parsed.protocol === 'http:')) ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      parsed.search
    )
      throw new Error();
  } catch {
    throw new Error(
      `Invalid environment: ${key} requires HTTPS (HTTP loopback only when permitted), without credentials/query/fragment`,
    );
  }
  return value;
}
