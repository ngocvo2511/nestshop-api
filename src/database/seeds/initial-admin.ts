import { hashPassword, validPassword } from '../../modules/auth/password';
import { DataSource } from 'typeorm';
import { Environment, text } from '../../config/environment';
import { User } from '../../modules/users/entities/user.entity';

export function adminInput(env: Environment) {
  const email = text(env, 'INITIAL_ADMIN_EMAIL').toLowerCase();
  const password = text(env, 'INITIAL_ADMIN_PASSWORD');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('Invalid environment: INITIAL_ADMIN_EMAIL');
  if (!validPassword(password))
    throw new Error(
      'Invalid environment: INITIAL_ADMIN_PASSWORD requires 12–128 characters',
    );
  return { email, password };
}

/** Controlled initial creation only; never promotes or overwrites an existing account. */
export async function setupInitialAdmin(
  source: DataSource,
  input: ReturnType<typeof adminInput>,
): Promise<'created' | 'existing'> {
  return source.transaction(async (manager) => {
    const existing = await manager.findOneBy(User, { email: input.email });
    if (existing) {
      if (existing.role !== 'ADMIN')
        throw new Error(
          'Initial admin email already belongs to a non-admin account; no change made',
        );
      return 'existing';
    }
    const user = manager.create(User, {
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: 'ADMIN',
    });
    const result = await manager.query<Array<{ id: string }>>(
      'INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING RETURNING id',
      [user.id, user.email, user.passwordHash, user.role],
    );
    const saved = await manager.findOneByOrFail(User, { email: input.email });
    if (saved.role !== 'ADMIN')
      throw new Error(
        'Initial admin email already belongs to a non-admin account; no change made',
      );
    return result.length ? 'created' : 'existing';
  });
}
