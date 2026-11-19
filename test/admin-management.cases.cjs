const {
  describe,
  beforeAll,
  afterAll,
  test,
  expect,
} = require('@jest/globals');
const { randomUUID, randomBytes } = require('node:crypto');
const { startBuiltApplication } = require('./helpers/app-process.cjs');

function registerAdminManagementCases(getSource, appDatabase) {
  describe('Admin staff, catalog visibility and inventory history', () => {
    let source, app, admin, customer;
    async function request(method, path, body, token) {
      const response = await fetch(app.base + '/api/v1' + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    }
    const credentials = () => ({
      email: `${randomUUID()}@admin-management.invalid`,
      password: randomBytes(24).toString('hex'),
      fullName: 'Staff fixture',
    });
    const signIn = ({ email, password }) =>
      request('POST', '/auth/login', { email, password });
    async function account(role) {
      const input = credentials();
      const created = await request('POST', '/auth/register', input);
      expect(created.status).toBe(201);
      if (role !== 'CUSTOMER')
        await source.query('UPDATE users SET role=$2 WHERE id=$1', [
          created.body.data.id,
          role,
        ]);
      const login = await signIn(input);
      expect(login.status).toBe(200);
      return { input, user: login.body.data.user, ...login.body.data };
    }
    beforeAll(async () => {
      source = getSource();
      app = await startBuiltApplication(appDatabase());
      admin = await account('ADMIN');
      customer = await account('CUSTOMER');
    });
    afterAll(async () => {
      await app?.close();
    });

    test('login returns basic identity; refresh returns only a new token pair; me retains full profile', async () => {
      const session = await account('CUSTOMER');
      expect(Object.keys(session.user).sort()).toEqual(
        ['id', 'email', 'role', 'fullName'].sort(),
      );
      const refreshed = await request('POST', '/auth/refresh', {
        refreshToken: session.refreshToken,
      });
      expect(refreshed.status).toBe(200);
      expect(Object.keys(refreshed.body.data).sort()).toEqual(
        [
          'accessToken',
          'tokenType',
          'expiresIn',
          'refreshToken',
          'refreshExpiresAt',
        ].sort(),
      );
      const me = await request(
        'GET',
        '/users/me',
        undefined,
        refreshed.body.data.accessToken,
      );
      expect(me.status).toBe(200);
      expect(me.body.data).toMatchObject({
        id: session.user.id,
        isActive: true,
        phoneNumber: null,
      });
      expect(me.body.data).toHaveProperty('createdAt');
    });
    test('admin creates fixed-role staff; duplicate/protected inputs are rejected', async () => {
      const input = credentials();
      const created = await request(
        'POST',
        '/admin/staff',
        input,
        admin.accessToken,
      );
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        role: 'STAFF',
        isActive: true,
        email: input.email,
      });
      expect(created.body.data).toHaveProperty('createdAt');
      expect(JSON.stringify(created.body)).not.toContain(input.password);
      expect(created.body.data).not.toHaveProperty('passwordHash');
      const login = await signIn(input);
      expect(login.status).toBe(200);
      expect(login.body.data.user.role).toBe('STAFF');
      expect(
        (await request('POST', '/admin/staff', input, admin.accessToken)).body
          .error.code,
      ).toBe('EMAIL_IN_USE');
      for (const extra of [
        { role: 'ADMIN' },
        { isActive: false },
        { passwordHash: 'injected' },
      ]) {
        expect(
          (
            await request(
              'POST',
              '/admin/staff',
              { ...credentials(), ...extra },
              admin.accessToken,
            )
          ).status,
        ).toBe(400);
      }
      expect(
        (
          await request(
            'PATCH',
            `/admin/staff/${customer.user.id}/status`,
            { isActive: false },
            admin.accessToken,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await request(
            'PATCH',
            `/admin/staff/${admin.user.id}/status`,
            { isActive: false },
            admin.accessToken,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await request(
            'GET',
            '/admin/users/roles?role=STAFF',
            undefined,
            admin.accessToken,
          )
        ).body.data.items.some((u) => u.id === created.body.data.id),
      ).toBe(true);
    });
    test('disabling staff rejects old access, login and refresh; enabling retains history and revoked sessions', async () => {
      const staff = await account('STAFF');
      const id = staff.user.id;
      const path = `/admin/staff/${id}/status`;
      expect(
        (await request('PATCH', path, { isActive: 'false' }, admin.accessToken))
          .status,
      ).toBe(400);
      expect(
        (await request('GET', '/users/me', undefined, staff.accessToken))
          .status,
      ).toBe(200);
      expect(
        (await request('PATCH', path, { isActive: false }, admin.accessToken))
          .body.data.isActive,
      ).toBe(false);
      expect(
        (await request('GET', '/users/me', undefined, staff.accessToken))
          .status,
      ).toBe(401);
      expect(
        (await request('GET', '/staff/orders', undefined, staff.accessToken))
          .status,
      ).toBe(401);
      expect((await signIn(staff.input)).status).toBe(401);
      expect(
        (
          await request('POST', '/auth/refresh', {
            refreshToken: staff.refreshToken,
          })
        ).status,
      ).toBe(401);
      const before = await source.query(
        'SELECT * FROM refresh_tokens WHERE user_id=$1',
        [id],
      );
      expect(
        before.every(
          (t) => t.status === 'REVOKED' && t.revocation_reason === 'LOGOUT',
        ),
      ).toBe(true);
      expect(
        (await request('PATCH', path, { isActive: false }, admin.accessToken))
          .status,
      ).toBe(200);
      expect(
        await source.query('SELECT * FROM refresh_tokens WHERE user_id=$1', [
          id,
        ]),
      ).toEqual(before);
      expect(
        (await request('PATCH', path, { isActive: true }, admin.accessToken))
          .body.data.id,
      ).toBe(id);
      expect(
        (
          await request('POST', '/auth/refresh', {
            refreshToken: staff.refreshToken,
          })
        ).status,
      ).toBe(401);
      expect((await signIn(staff.input)).status).toBe(200);
      expect(
        (await request('GET', '/users/me', undefined, staff.accessToken))
          .status,
      ).toBe(200);
    });

    test('disabling staff serializes with login and refresh and leaves no usable session', async () => {
      const staff = await account('STAFF');
      const results = await Promise.all([
        signIn(staff.input),
        request('POST', '/auth/refresh', {
          refreshToken: staff.refreshToken,
        }),
        request(
          'PATCH',
          `/admin/staff/${staff.user.id}/status`,
          { isActive: false },
          admin.accessToken,
        ),
      ]);
      expect(results[2].status).toBe(200);
      for (const result of results.slice(0, 2)) {
        expect([200, 401]).toContain(result.status);
        if (result.status === 200) {
          expect(
            (
              await request(
                'GET',
                '/users/me',
                undefined,
                result.body.data.accessToken,
              )
            ).status,
          ).toBe(401);
          expect(
            (
              await request('POST', '/auth/refresh', {
                refreshToken: result.body.data.refreshToken,
              })
            ).status,
          ).toBe(401);
        }
      }
      const sessions = await source.query(
        'SELECT status FROM refresh_tokens WHERE user_id=$1',
        [staff.user.id],
      );
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((session) => session.status === 'REVOKED')).toBe(
        true,
      );
    });
    test('new administrative routes reject guests, customers and staff', async () => {
      const staff = await account('STAFF');
      const routes = [
        ['POST', '/admin/staff', credentials()],
        ['PATCH', `/admin/staff/${staff.user.id}/status`, { isActive: false }],
      ];
      for (const [method, path, body] of routes) {
        expect((await request(method, path, body)).status).toBe(401);
        for (const token of [customer.accessToken, staff.accessToken])
          expect((await request(method, path, body, token)).status).toBe(403);
      }
    });
    test('Swagger documents actual auth payloads and endpoint-specific error examples', async () => {
      const spec = await (await fetch(app.base + '/api/docs-json')).json();
      const me = spec.paths['/api/v1/users/me'];
      expect(me.get.responses['400'].description).not.toContain(
        'INVALID_CURRENT_PASSWORD',
      );
      expect(me.patch.responses['400'].description).toContain('EMPTY_UPDATE');
      expect(
        spec.paths['/api/v1/users/me/password'].post.responses['400'].content[
          'application/json'
        ].examples.INVALID_CURRENT_PASSWORD.value.error.code,
      ).toBe('INVALID_CURRENT_PASSWORD');
      expect(
        spec.paths['/api/v1/auth/refresh'].post.responses['200'].content[
          'application/json'
        ].schema.properties.data.properties,
      ).not.toHaveProperty('user');
    });
  });
}
module.exports = { registerAdminManagementCases };
