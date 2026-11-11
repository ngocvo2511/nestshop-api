const {
  describe,
  beforeAll,
  afterAll,
  test,
  expect,
} = require('@jest/globals');
const { randomBytes, randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { startBuiltApplication } = require('./helpers/app-process.cjs');

function registerAccountCases(getSource, appDatabase) {
  describe('Day 5 account APIs with committed PostgreSQL state', () => {
    let source;
    let app;
    let admin;
    beforeAll(async () => {
      source = getSource();
      app = await startBuiltApplication(appDatabase());
      admin = await account('ADMIN');
    });
    afterAll(async () => {
      await app?.close();
    });

    async function request(method, path, body, token) {
      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = 'Bearer ' + token;
      const response = await fetch(app.base + '/api/v1' + path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text ? JSON.parse(text) : null,
        text,
        cache: response.headers.get('cache-control'),
        type: response.headers.get('content-type'),
      };
    }
    async function account(role = 'CUSTOMER') {
      const credentials = {
        email: `${randomUUID()}@account.invalid`,
        password: randomBytes(24).toString('hex'),
      };
      const registered = await request('POST', '/auth/register', credentials);
      expect(registered.status).toBe(201);
      const user = registered.body.data;
      // Synthetic role fixture only: public registration never accepts a role.
      if (role !== 'CUSTOMER')
        await source.query('UPDATE users SET role=$2 WHERE id=$1', [
          user.id,
          role,
        ]);
      const login = await request('POST', '/auth/login', credentials);
      expect(login.status).toBe(200);
      return { user: login.body.data.user, credentials, pair: login.body.data };
    }
    function tokens(id) {
      return source.query(
        'SELECT * FROM refresh_tokens WHERE user_id=$1 ORDER BY id',
        [id],
      );
    }
    async function userRow(id) {
      return (await source.query('SELECT * FROM users WHERE id=$1', [id]))[0];
    }
    function audits(id) {
      return source.query(
        'SELECT * FROM role_change_audit WHERE affected_user_id=$1 ORDER BY created_at,id',
        [id],
      );
    }
    async function waitUsers(count) {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        const rows = await source.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%users%' AND query LIKE '%FOR UPDATE%'",
        );
        if (rows[0].count >= count) return;
        await delay(15);
      }
      throw new Error('Independent user-lock waiters were not observed');
    }
    async function heldUser(id) {
      const runner = source.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      await runner.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [id]);
      return runner;
    }
    async function queued(id, first, second) {
      const runner = await heldUser(id);
      const pending = [];
      try {
        pending.push(first());
        await waitUsers(1);
        pending.push(second());
        await waitUsers(2);
        await runner.commitTransaction();
        return await Promise.all(pending);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await Promise.allSettled(pending);
      }
    }
    function expect204(result) {
      expect(result.status).toBe(204);
      expect(result.text).toBe('');
      expect(result.type).toBeNull();
    }
    function safeUser(user) {
      expect(Object.keys(user).sort()).toEqual(
        [
          'id',
          'email',
          'role',
          'isActive',
          'fullName',
          'phoneNumber',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
    }

    test.each(['GUEST', 'CUSTOMER', 'STAFF', 'ADMIN'])(
      '%s permissions and safe own profile',
      async (role) => {
        const fixture =
          role === 'GUEST'
            ? null
            : role === 'ADMIN'
              ? admin
              : await account(role);
        const access = fixture?.pair.accessToken;
        const target = randomUUID();
        const protectedCalls = [
          request('GET', '/users/me', undefined, access),
          request('PATCH', '/users/me', { fullName: 'Own account' }, access),
          request('GET', '/admin/users/roles', undefined, access),
          request(
            'PATCH',
            `/admin/users/${target}/role`,
            { role: 'STAFF' },
            access,
          ),
        ];
        const result = await Promise.all(protectedCalls);
        if (role === 'GUEST')
          expect(result.map((row) => row.status)).toEqual([401, 401, 401, 401]);
        else {
          expect(result.slice(0, 2).map((row) => row.status)).toEqual([
            200, 200,
          ]);
          safeUser(result[0].body.data);
          safeUser(result[1].body.data);
          expect(result[0].body.data.id).toBe(fixture.user.id);
          expect(result[2].status).toBe(role === 'ADMIN' ? 200 : 403);
          expect(result[3].status).toBe(role === 'ADMIN' ? 404 : 403);
        }
        const password = await request(
          'POST',
          '/users/me/password',
          {
            currentPassword: randomBytes(24).toString('hex'),
            newPassword: randomBytes(24).toString('hex'),
          },
          access,
        );
        expect(password.status).toBe(role === 'GUEST' ? 401 : 400);
      },
    );

    test('own-profile GET is read-only; PATCH trims/clears allowlisted fields and cannot access foreign records', async () => {
      const a = await account();
      const b = await account();
      const before = await userRow(a.user.id);
      const other = await userRow(b.user.id);
      const get = await request(
        'GET',
        '/users/me',
        undefined,
        a.pair.accessToken,
      );
      expect(get.status).toBe(200);
      expect(get.cache).toBe('no-store');
      safeUser(get.body.data);
      expect(await userRow(a.user.id)).toEqual(before);
      const patch = await request(
        'PATCH',
        '/users/me',
        { fullName: '  Updated person  ', phoneNumber: ' +84901234567 ' },
        a.pair.accessToken,
      );
      expect(patch.status).toBe(200);
      expect(patch.body.data).toMatchObject({
        id: a.user.id,
        fullName: 'Updated person',
        phoneNumber: '+84901234567',
      });
      expect((await userRow(a.user.id)).password_hash).toBe(
        before.password_hash,
      );
      expect(
        (
          await request(
            'GET',
            `/users/${b.user.id}`,
            undefined,
            a.pair.accessToken,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await request(
            'PATCH',
            `/users/${b.user.id}`,
            { fullName: 'Foreign' },
            a.pair.accessToken,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await request(
            'GET',
            `/users/me?userId=${b.user.id}`,
            undefined,
            a.pair.accessToken,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await request(
            'PATCH',
            '/users/me',
            { userId: b.user.id, fullName: 'Foreign' },
            a.pair.accessToken,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await request(
            'POST',
            '/users/me/password',
            {
              userId: b.user.id,
              currentPassword: a.credentials.password,
              newPassword: randomBytes(24).toString('hex'),
            },
            a.pair.accessToken,
          )
        ).status,
      ).toBe(400);
      expect(await userRow(b.user.id)).toEqual(other);
      expect(
        (await request('PATCH', '/users/me', {}, a.pair.accessToken)).body.error
          .code,
      ).toBe('EMPTY_UPDATE');
      const cleared = await request(
        'PATCH',
        '/users/me',
        { fullName: null, phoneNumber: null },
        a.pair.accessToken,
      );
      expect(cleared.status).toBe(200);
      expect(cleared.body.data.fullName).toBeNull();
      expect(cleared.body.data.phoneNumber).toBeNull();
    });

    test('register/profile reject all protected fields and invalid phone/name without changing stored secrets', async () => {
      const fixture = await account();
      const before = await userRow(fixture.user.id);
      for (const key of [
        'id',
        'userId',
        'role',
        'isActive',
        'email',
        'password',
        'passwordHash',
        'refreshToken',
        'refreshTokens',
        'avatarUrl',
        'createdAt',
      ]) {
        const patch = await request(
          'PATCH',
          '/users/me',
          { [key]: 'protected' },
          fixture.pair.accessToken,
        );
        expect(patch.status).toBe(400);
        if (!['email', 'password'].includes(key)) {
          const registration = await request('POST', '/auth/register', {
            ...fixture.credentials,
            email: `${randomUUID()}@account.invalid`,
            [key]: 'protected',
          });
          expect(registration.status).toBe(400);
        }
      }
      for (const body of [
        { fullName: '' },
        { fullName: 'a'.repeat(201) },
        { fullName: 'Bad\nname' },
        { phoneNumber: '123' },
        { phoneNumber: 84901234567 },
      ])
        expect(
          (await request('PATCH', '/users/me', body, fixture.pair.accessToken))
            .status,
        ).toBe(400);
      expect(await userRow(fixture.user.id)).toEqual(before);
      const publicResult = await request(
        'GET',
        '/users/me',
        undefined,
        fixture.pair.accessToken,
      );
      safeUser(publicResult.body.data);
      for (const sensitive of [
        before.password_hash,
        fixture.credentials.password,
        fixture.pair.refreshToken,
        fixture.pair.accessToken,
      ]) {
        expect(publicResult.text.includes(sensitive)).toBe(false);
        expect(app.output().includes(sensitive)).toBe(false);
      }
    });

    test('logout from consumed predecessor revokes only supplied family, is idempotent, and leaves access JWT usable', async () => {
      const fixture = await account();
      const other = (await request('POST', '/auth/login', fixture.credentials))
        .body.data;
      const rotated = await request('POST', '/auth/refresh', {
        refreshToken: fixture.pair.refreshToken,
      });
      expect(rotated.status).toBe(200);
      expect204(
        await request('POST', '/auth/logout', {
          refreshToken: fixture.pair.refreshToken,
        }),
      );
      const before = await tokens(fixture.user.id);
      const revoked = before.filter((row) => row.status === 'REVOKED');
      expect(revoked).toHaveLength(2);
      expect(revoked.filter((row) => row.consumed_at !== null)).toHaveLength(1);
      expect(
        revoked.every(
          (row) =>
            row.revocation_reason === 'LOGOUT' && row.revoked_at !== null,
        ),
      ).toBe(true);
      for (const raw of [
        fixture.pair.refreshToken,
        rotated.body.data.refreshToken,
      ]) {
        expect204(await request('POST', '/auth/logout', { refreshToken: raw }));
        expect(
          (await request('POST', '/auth/refresh', { refreshToken: raw })).body
            .error.code,
        ).toBe('INVALID_REFRESH_TOKEN');
      }
      expect(await tokens(fixture.user.id)).toEqual(before);
      expect(
        (await request('GET', '/users/me', undefined, fixture.pair.accessToken))
          .status,
      ).toBe(200);
      expect(
        (
          await request('POST', '/auth/refresh', {
            refreshToken: other.refreshToken,
          })
        ).status,
      ).toBe(200);
      expect204(
        await request('POST', '/auth/logout', {
          refreshToken: randomBytes(32).toString('base64url'),
        }),
      );
      expect(
        (await request('POST', '/auth/logout', { refreshToken: 'malformed' }))
          .status,
      ).toBe(400);
    });

    test.each(['logout', 'refresh'])(
      'concurrent logout versus %s never restores a family or creates new replay',
      async (operation) => {
        const fixture = await account();
        const call = (route) =>
          request('POST', '/auth/' + route, {
            refreshToken: fixture.pair.refreshToken,
          });
        const results = await queued(
          fixture.user.id,
          () => call(operation),
          () => call('logout'),
        );
        expect204(results[1]);
        if (operation === 'logout') expect204(results[0]);
        else expect(results[0].status).toBe(200);
        const committed = await tokens(fixture.user.id);
        expect(committed).toHaveLength(operation === 'logout' ? 1 : 2);
        expect(
          committed.every(
            (row) =>
              row.status === 'REVOKED' && row.revocation_reason === 'LOGOUT',
          ),
        ).toBe(true);
        expect204(await call('logout'));
        expect(await tokens(fixture.user.id)).toEqual(committed);
        expect((await call('refresh')).body.error.code).toBe(
          'INVALID_REFRESH_TOKEN',
        );
      },
    );

    test('logout-first refresh contention rejects without rotation; expired/replay-revoked logout is a no-op', async () => {
      const fixture = await account();
      const results = await queued(
        fixture.user.id,
        () =>
          request('POST', '/auth/logout', {
            refreshToken: fixture.pair.refreshToken,
          }),
        () =>
          request('POST', '/auth/refresh', {
            refreshToken: fixture.pair.refreshToken,
          }),
      );
      expect204(results[0]);
      expect(results[1].body.error.code).toBe('INVALID_REFRESH_TOKEN');
      expect(await tokens(fixture.user.id)).toHaveLength(1);
      const expired = await account();
      await source.query(
        "UPDATE refresh_tokens SET expires_at=created_at+interval '1 microsecond' WHERE user_id=$1",
        [expired.user.id],
      );
      const before = await tokens(expired.user.id);
      expect204(
        await request('POST', '/auth/logout', {
          refreshToken: expired.pair.refreshToken,
        }),
      );
      expect(await tokens(expired.user.id)).toEqual(before);
      const replay = await account();
      await request('POST', '/auth/refresh', {
        refreshToken: replay.pair.refreshToken,
      });
      await request('POST', '/auth/refresh', {
        refreshToken: replay.pair.refreshToken,
      });
      const replayBefore = await tokens(replay.user.id);
      expect204(
        await request('POST', '/auth/logout', {
          refreshToken: replay.pair.refreshToken,
        }),
      );
      expect(await tokens(replay.user.id)).toEqual(replayBefore);
    });

    test('password errors preserve hash/sessions; success revokes all families, keeps ordinary logout metadata and stateless access', async () => {
      const fixture = await account();
      const newPassword = randomBytes(24).toString('hex');
      const loggedOut = (
        await request('POST', '/auth/login', fixture.credentials)
      ).body.data;
      await request('POST', '/auth/logout', {
        refreshToken: loggedOut.refreshToken,
      });
      await request('POST', '/auth/login', fixture.credentials);
      await request('POST', '/auth/refresh', {
        refreshToken: fixture.pair.refreshToken,
      });
      const before = await userRow(fixture.user.id);
      const sessionsBefore = await tokens(fixture.user.id);
      const wrong = await request(
        'POST',
        '/users/me/password',
        { currentPassword: randomBytes(24).toString('hex'), newPassword },
        fixture.pair.accessToken,
      );
      expect(wrong.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
      expect(
        (
          await request(
            'POST',
            '/users/me/password',
            {
              currentPassword: fixture.credentials.password,
              newPassword: fixture.credentials.password,
            },
            fixture.pair.accessToken,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await request(
            'POST',
            '/users/me/password',
            {
              currentPassword: fixture.credentials.password,
              newPassword: 'short',
            },
            fixture.pair.accessToken,
          )
        ).status,
      ).toBe(400);
      expect(await userRow(fixture.user.id)).toEqual(before);
      expect(await tokens(fixture.user.id)).toEqual(sessionsBefore);
      expect204(
        await request(
          'POST',
          '/users/me/password',
          { currentPassword: fixture.credentials.password, newPassword },
          fixture.pair.accessToken,
        ),
      );
      const after = await tokens(fixture.user.id);
      expect(after).toHaveLength(sessionsBefore.length);
      for (const row of after) {
        const old = sessionsBefore.find((item) => item.id === row.id);
        if (old.revocation_reason === 'LOGOUT') expect(row).toEqual(old);
        else {
          expect(row.status).toBe('REVOKED');
          expect(row.revocation_reason).toBe('PASSWORD_CHANGE');
          expect(row.revoked_at).not.toBeNull();
          expect(row.consumed_at).toEqual(old.consumed_at);
        }
      }
      const rejected = await request('POST', '/auth/refresh', {
        refreshToken: fixture.pair.refreshToken,
      });
      expect(rejected.body.error.code).toBe('INVALID_REFRESH_TOKEN');
      expect(await tokens(fixture.user.id)).toEqual(after);
      expect(
        (await request('GET', '/users/me', undefined, fixture.pair.accessToken))
          .status,
      ).toBe(200);
      expect(
        (await request('POST', '/auth/login', fixture.credentials)).status,
      ).toBe(401);
      expect(
        (
          await request('POST', '/auth/login', {
            ...fixture.credentials,
            password: newPassword,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await request(
            'POST',
            '/users/me/password',
            {
              currentPassword: fixture.credentials.password,
              newPassword: randomBytes(24).toString('hex'),
            },
            fixture.pair.accessToken,
          )
        ).body.error.code,
      ).toBe('INVALID_CURRENT_PASSWORD');
    });

    test.each([
      ['password', 'login'],
      ['login', 'password'],
      ['password', 'refresh'],
      ['refresh', 'password'],
    ])(
      '%s queued before %s: password/login/refresh serialize with no surviving old-credential session',
      async (first, second) => {
        const fixture = await account();
        const newPassword = randomBytes(24).toString('hex');
        await request('POST', '/auth/login', fixture.credentials);
        const operation = (kind) =>
          kind === 'password'
            ? request(
                'POST',
                '/users/me/password',
                { currentPassword: fixture.credentials.password, newPassword },
                fixture.pair.accessToken,
              )
            : kind === 'login'
              ? request('POST', '/auth/login', fixture.credentials)
              : request('POST', '/auth/refresh', {
                  refreshToken: fixture.pair.refreshToken,
                });
        const results = await queued(
          fixture.user.id,
          () => operation(first),
          () => operation(second),
        );
        expect204(results[first === 'password' ? 0 : 1]);
        expect(results[first === 'password' ? 1 : 0].status).toBe(
          first === 'password' ? 401 : 200,
        );
        const committed = await tokens(fixture.user.id);
        expect(
          committed.every(
            (row) =>
              row.status === 'REVOKED' &&
              row.revocation_reason === 'PASSWORD_CHANGE',
          ),
        ).toBe(true);
        expect(committed).toHaveLength(first === 'password' ? 2 : 3);
        expect(
          (await request('POST', '/auth/login', fixture.credentials)).status,
        ).toBe(401);
        expect(
          (
            await request('POST', '/auth/login', {
              ...fixture.credentials,
              password: newPassword,
            })
          ).status,
        ).toBe(200);
        expect(
          (
            await request(
              'GET',
              '/users/me',
              undefined,
              fixture.pair.accessToken,
            )
          ).status,
        ).toBe(200);
      },
    );

    test('two password changes with the same old password have one winner', async () => {
      const fixture = await account();
      const replacements = [
        randomBytes(24).toString('hex'),
        randomBytes(24).toString('hex'),
      ];
      const change = (index) =>
        request(
          'POST',
          '/users/me/password',
          {
            currentPassword: fixture.credentials.password,
            newPassword: replacements[index],
          },
          fixture.pair.accessToken,
        );
      const results = await queued(
        fixture.user.id,
        () => change(0),
        () => change(1),
      );
      expect204(results[0]);
      expect(results[1].body.error.code).toBe('INVALID_CURRENT_PASSWORD');
      expect(
        (await tokens(fixture.user.id)).every(
          (row) => row.revocation_reason === 'PASSWORD_CHANGE',
        ),
      ).toBe(true);
      expect(
        (
          await request('POST', '/auth/login', {
            ...fixture.credentials,
            password: replacements[0],
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await request('POST', '/auth/login', {
            ...fixture.credentials,
            password: replacements[1],
          })
        ).status,
      ).toBe(401);
    });

    test('ADMIN listing is filtered, bounded, deterministic and secret-free; role no-op has no write/audit', async () => {
      const fixture = await account('STAFF');
      await source.query(
        "UPDATE users SET created_at='2026-01-01T00:00:00Z' WHERE id=$1",
        [fixture.user.id],
      );
      const all = await source.query(
        "SELECT id,email,role,is_active FROM users WHERE role='STAFF' ORDER BY created_at DESC,id DESC",
      );
      const list = await request(
        'GET',
        '/admin/users/roles?role=STAFF&offset=0&limit=2',
        undefined,
        admin.pair.accessToken,
      );
      expect(list.status).toBe(200);
      expect(list.body.data.total).toBe(all.length);
      expect(list.body.data.items.map((row) => row.id)).toEqual(
        all.slice(0, 2).map((row) => row.id),
      );
      for (const row of list.body.data.items)
        expect(Object.keys(row).sort()).toEqual(
          ['id', 'email', 'role', 'isActive'].sort(),
        );
      for (const query of [
        'role=ROOT',
        'sort=email',
        'limit=101',
        'offset=-1',
        'role=STAFF&role=ADMIN',
        'limit=02',
      ])
        expect(
          (
            await request(
              'GET',
              '/admin/users/roles?' + query,
              undefined,
              admin.pair.accessToken,
            )
          ).status,
        ).toBe(400);
      const before = await userRow(fixture.user.id);
      const noop = await request(
        'PATCH',
        `/admin/users/${fixture.user.id}/role`,
        { role: 'STAFF' },
        admin.pair.accessToken,
      );
      expect(noop.body.data).toMatchObject({ changed: false, auditId: null });
      expect(await userRow(fixture.user.id)).toEqual(before);
      expect(await audits(fixture.user.id)).toHaveLength(0);
      for (const body of [
        { role: 'ADMIN', isActive: false },
        { role: 'ROOT' },
        { role: 'ADMIN', actorUserId: fixture.user.id },
      ])
        expect(
          (
            await request(
              'PATCH',
              `/admin/users/${fixture.user.id}/role`,
              body,
              admin.pair.accessToken,
            )
          ).status,
        ).toBe(400);
    });

    test('audited role change uses verified actor; old access role remains until expiry and new login/refresh reflect current role', async () => {
      const target = await account('ADMIN');
      const changed = await request(
        'PATCH',
        `/admin/users/${target.user.id}/role`,
        { role: 'CUSTOMER' },
        admin.pair.accessToken,
      );
      expect(changed.status).toBe(200);
      expect(changed.body.data.changed).toBe(true);
      expect((await userRow(target.user.id)).role).toBe('CUSTOMER');
      const audit = await audits(target.user.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        id: changed.body.data.auditId,
        actor_user_id: admin.user.id,
        affected_user_id: target.user.id,
        old_role: 'ADMIN',
        new_role: 'CUSTOMER',
      });
      expect(audit[0].created_at).toBeInstanceOf(Date);
      expect(
        (
          await request(
            'GET',
            '/admin/users/roles',
            undefined,
            target.pair.accessToken,
          )
        ).status,
      ).toBe(200);
      const refreshed = await request('POST', '/auth/refresh', {
        refreshToken: target.pair.refreshToken,
      });
      expect(refreshed.body.data.user.role).toBe('CUSTOMER');
      expect(
        (
          await request(
            'GET',
            '/admin/users/roles',
            undefined,
            refreshed.body.data.accessToken,
          )
        ).status,
      ).toBe(403);
      const logged = await request('POST', '/auth/login', target.credentials);
      expect(logged.body.data.user.role).toBe('CUSTOMER');
      expect(
        (
          await request(
            'GET',
            '/admin/users/roles',
            undefined,
            logged.body.data.accessToken,
          )
        ).status,
      ).toBe(403);
      // Self-demotion is allowed; no undeclared last-admin policy.
      expect(
        (
          await request(
            'PATCH',
            `/admin/users/${target.user.id}/role`,
            { role: 'STAFF' },
            target.pair.accessToken,
          )
        ).status,
      ).toBe(200);
      expect((await audits(target.user.id))[1].actor_user_id).toBe(
        target.user.id,
      );
    });

    test('concurrent same-role assignment creates exactly one audit', async () => {
      const target = await account();
      const change = () =>
        request(
          'PATCH',
          `/admin/users/${target.user.id}/role`,
          { role: 'STAFF' },
          admin.pair.accessToken,
        );
      const results = await queued(target.user.id, change, change);
      expect(results.map((row) => row.status)).toEqual([200, 200]);
      expect(results.filter((row) => row.body.data.changed)).toHaveLength(1);
      expect(
        results.filter((row) => row.body.data.auditId === null),
      ).toHaveLength(1);
      const committed = await audits(target.user.id);
      expect(committed).toHaveLength(1);
      expect(committed[0]).toMatchObject({
        old_role: 'CUSTOMER',
        new_role: 'STAFF',
        actor_user_id: admin.user.id,
      });
      expect((await userRow(target.user.id)).role).toBe('STAFF');
    });

    test.each(['role', 'password'])(
      '%s write rolls back when its audit/revocation fails in PostgreSQL',
      async (kind) => {
        const fixture = await account();
        const before = await userRow(fixture.user.id);
        const sessions = await tokens(fixture.user.id);
        const name = 'day5_fault_' + randomBytes(8).toString('hex');
        const table = kind === 'role' ? 'role_change_audit' : 'refresh_tokens';
        expect(fixture.user.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(name).toMatch(/^day5_fault_[0-9a-f]{16}$/);
        const condition =
          kind === 'role'
            ? `affected_user_id <> '${fixture.user.id}'::uuid`
            : `user_id <> '${fixture.user.id}'::uuid OR revocation_reason IS DISTINCT FROM 'PASSWORD_CHANGE'`;
        await source.query(
          `ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${condition})`,
        );
        try {
          const result =
            kind === 'role'
              ? await request(
                  'PATCH',
                  `/admin/users/${fixture.user.id}/role`,
                  { role: 'STAFF' },
                  admin.pair.accessToken,
                )
              : await request(
                  'POST',
                  '/users/me/password',
                  {
                    currentPassword: fixture.credentials.password,
                    newPassword: randomBytes(24).toString('hex'),
                  },
                  fixture.pair.accessToken,
                );
          expect(result.status).toBe(500);
          expect(result.body.error.code).toBe('INTERNAL_ERROR');
          expect(result.text.includes(name)).toBe(false);
          expect(await userRow(fixture.user.id)).toEqual(before);
          expect(await tokens(fixture.user.id)).toEqual(sessions);
          expect(await audits(fixture.user.id)).toHaveLength(0);
        } finally {
          await source.query(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
        }
        expect(
          (await request('POST', '/auth/login', fixture.credentials)).status,
        ).toBe(200);
      },
    );

    test('real issued access JWT survives logout until configured expiry, then protected profile rejects it', async () => {
      const fixture = await account();
      const shortApp = await startBuiltApplication(appDatabase(), {
        accessTtlSeconds: 3,
        refreshTtlSeconds: 30,
      });
      try {
        const response = await fetch(shortApp.base + '/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fixture.credentials),
        });
        expect(response.status).toBe(200);
        const pair = (await response.json()).data;
        expect(pair.expiresIn).toBe(3);
        const profile = () =>
          fetch(shortApp.base + '/api/v1/users/me', {
            headers: { Authorization: 'Bearer ' + pair.accessToken },
          });
        expect((await profile()).status).toBe(200);
        const logout = await fetch(shortApp.base + '/api/v1/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: pair.refreshToken }),
        });
        expect(logout.status).toBe(204);
        expect((await profile()).status).toBe(200);
        const deadline = Date.now() + 5000;
        let last;
        do {
          await delay(40);
          last = await profile();
        } while (last.status === 200 && Date.now() < deadline);
        expect(last.status).toBe(401);
        expect((await last.json()).error.code).toBe('UNAUTHORIZED');
      } finally {
        await shortApp.close();
      }
    });

    test('actual Swagger advertises only implemented account scope, Bearer protection and safe models', async () => {
      const spec = await (await fetch(app.base + '/api/docs-json')).json();
      for (const path of [
        '/api/v1/users/me',
        '/api/v1/users/me/password',
        '/api/v1/admin/users/roles',
        '/api/v1/admin/users/{id}/role',
      ]) {
        expect(spec.paths[path]).toBeDefined();
        for (const operation of Object.values(spec.paths[path]))
          expect(operation.security).toEqual([{ bearer: [] }]);
      }
      expect(
        spec.paths['/api/v1/auth/logout'].post.responses['204'],
      ).toBeDefined();
      expect(
        spec.paths['/api/v1/users/me'].get.responses['200'].content[
          'application/json'
        ].schema.properties.data.properties.passwordHash,
      ).toBeUndefined();
      expect(spec.paths['/api/v1/users/{id}']).toBeUndefined();
    });
  });
}

module.exports = { registerAccountCases };
