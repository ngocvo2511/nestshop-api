import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export function validPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    Array.from(value).length >= 12 &&
    Array.from(value).length <= 128 &&
    !/\p{Cc}/u.test(value)
  );
}

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$131072$8$1$${salt}$${(await derive(password, salt)).toString('hex')}`;
}

// Also perform a full derivation for missing/unsupported hashes.
export async function verifyPassword(
  password: string,
  encoded?: string,
): Promise<boolean> {
  const match = /^scrypt\$131072\$8\$1\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(
    encoded ?? '',
  );
  const actual = await derive(password, match?.[1] ?? '0'.repeat(32));
  return (
    timingSafeEqual(
      actual,
      Buffer.from(match?.[2] ?? '0'.repeat(128), 'hex'),
    ) && !!match
  );
}
