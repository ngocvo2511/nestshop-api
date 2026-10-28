import { adminInput } from './initial-admin';

describe('controlled initial admin input', () => {
  it('normalizes email and accepts external credentials', () => {
    expect(
      adminInput({
        INITIAL_ADMIN_EMAIL: 'Owner@Example.invalid',
        INITIAL_ADMIN_PASSWORD: 'a'.repeat(24),
      }).email,
    ).toBe('owner@example.invalid');
  });

  it.each([
    {},
    { INITIAL_ADMIN_EMAIL: 'bad', INITIAL_ADMIN_PASSWORD: 'a'.repeat(24) },
    {
      INITIAL_ADMIN_EMAIL: 'owner@example.invalid',
      INITIAL_ADMIN_PASSWORD: 'short',
    },
    {
      INITIAL_ADMIN_EMAIL: 'owner@example.invalid',
      INITIAL_ADMIN_PASSWORD: 'a'.repeat(129),
    },
    {
      INITIAL_ADMIN_EMAIL: 'owner@example.invalid',
      INITIAL_ADMIN_PASSWORD: 'a'.repeat(15) + '\nunsafe',
    },
  ])(
    'rejects missing or invalid setup credentials without printing them',
    (env) => {
      expect(() => adminInput(env)).toThrow(
        'Invalid environment: INITIAL_ADMIN_',
      );
    },
  );
});
