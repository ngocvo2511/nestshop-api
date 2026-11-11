const {
  describe,
  beforeAll,
  afterAll,
  test,
  expect,
} = require('@jest/globals');
const { randomUUID, randomBytes } = require('node:crypto');
const { URLSearchParams } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { startBuiltApplication } = require('./helpers/app-process.cjs');

function registerProductCases(getSource, appDatabase) {
  describe('Day 6 catalog APIs on real PostgreSQL', () => {
    let source;
    let app;
    const actors = {};
    const prefix = 'day6-' + randomUUID();
    const rows = [];
    beforeAll(async () => {
      source = getSource();
      app = await startBuiltApplication(appDatabase());
      for (const role of ['CUSTOMER', 'STAFF', 'ADMIN']) {
        const credentials = {
          email: `${randomUUID()}@catalog.invalid`,
          password: randomBytes(24).toString('hex'),
        };
        const registration = await request(
          'POST',
          '/auth/register',
          credentials,
        );
        expect(registration.status).toBe(201);
        if (role !== 'CUSTOMER')
          await source.query('UPDATE users SET role=$2 WHERE id=$1', [
            registration.body.data.id,
            role,
          ]);
        const login = await request('POST', '/auth/login', credentials);
        expect(login.status).toBe(200);
        actors[role] = login.body.data.accessToken;
      }
      const fixtures = [
        ['Tie', '9007199254740993', 0, null, true],
        ['Tie', '9007199254740992', 7, 'A description', true],
        ['Alpha', '2', 10, 'Case-sensitive text is searchable', true],
        ['Zulu', '9223372036854775807', 1, null, true],
        ['Hidden', '1', 3, 'Private catalog note', false],
      ];
      for (const [label, price, stock, description, active] of fixtures)
        rows.push(
          await fixture({
            name: `${prefix} ${label}`,
            price,
            stock,
            description,
            active,
          }),
        );
    });
    afterAll(async () => {
      await app?.close();
    });
    async function request(method, path, body, role) {
      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (role) headers.Authorization = 'Bearer ' + actors[role];
      const response = await fetch(app.base + '/api/v1' + path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    }
    function listing(query = {}) {
      return request('GET', '/products?' + new URLSearchParams(query));
    }
    async function fixture({
      name,
      price = '10',
      stock = 4,
      description = null,
      active = true,
      image = null,
    }) {
      const id = randomUUID();
      const created = '2026-01-01T00:00:00.000Z';
      await source.query(
        'INSERT INTO products (id,name,description,price_vnd,stock_available,is_active,image_path,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)',
        [id, name, description, price, stock, active, image, created],
      );
      return {
        id,
        name,
        description,
        priceVnd: price,
        stockAvailable: stock,
        isActive: active,
        createdAt: created,
      };
    }
    async function dbRow(id) {
      return (
        await source.query('SELECT * FROM products WHERE id=$1', [id])
      )[0];
    }
    function safeProduct(product) {
      expect(Object.keys(product).sort()).toEqual(
        [
          'id',
          'name',
          'description',
          'priceVnd',
          'stockAvailable',
          'isActive',
          'imageUrl',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
      expect(typeof product.priceVnd).toBe('string');
    }

    test.each([undefined, 'CUSTOMER', 'STAFF', 'ADMIN'])(
      'public active-only reads and mutation permissions for %s',
      async (role) => {
        const active = rows[0];
        const inactive = rows[4];
        const list = await request(
          'GET',
          '/products?' + new URLSearchParams({ q: prefix }),
          undefined,
          role,
        );
        expect(list.status).toBe(200);
        expect(list.body.data.total).toBe(4);
        expect(list.body.data.items.every((row) => row.isActive)).toBe(true);
        expect(list.body.data.items.some((row) => row.id === inactive.id)).toBe(
          false,
        );
        for (const product of list.body.data.items) safeProduct(product);
        const detail = await request(
          'GET',
          `/products/${active.id.toUpperCase()}`,
          undefined,
          role,
        );
        expect(detail.status).toBe(200);
        expect(detail.body.data.priceVnd).toBe('9007199254740993');
        expect(detail.body.data.stockAvailable).toBe(0);
        safeProduct(detail.body.data);
        const missing = await request(
          'GET',
          `/products/${randomUUID()}`,
          undefined,
          role,
        );
        const hidden = await request(
          'GET',
          `/products/${inactive.id}`,
          undefined,
          role,
        );
        expect(missing.status).toBe(404);
        expect(hidden.status).toBe(404);
        expect(hidden.body.error).toEqual(missing.body.error);
        expect(hidden.body.error.code).toBe('NOT_FOUND');
        if (role !== 'ADMIN') {
          const before = await dbRow(active.id);
          expect(
            (
              await request(
                'POST',
                '/products',
                { name: 'Unauthorized', priceVnd: '1', initialStock: 0 },
                role,
              )
            ).status,
          ).toBe(role ? 403 : 401);
          expect(
            (
              await request(
                'PATCH',
                `/products/${active.id}`,
                { name: 'Unauthorized' },
                role,
              )
            ).status,
          ).toBe(role ? 403 : 401);
          expect(await dbRow(active.id)).toEqual(before);
        }
      },
    );

    test.each([
      'name',
      '-name',
      'priceVnd',
      '-priceVnd',
      'createdAt',
      '-createdAt',
    ])(
      '%s ordering, same-direction ID ties, offset/limit and filtered total',
      async (sort) => {
        const direction = sort.startsWith('-') ? -1 : 1;
        const key = sort.replace('-', '');
        const expected = rows
          .filter((row) => row.isActive)
          .sort((a, b) => {
            const av = key === 'priceVnd' ? BigInt(a[key]) : a[key];
            const bv = key === 'priceVnd' ? BigInt(b[key]) : b[key];
            return (
              direction *
              (av < bv
                ? -1
                : av > bv
                  ? 1
                  : a.id < b.id
                    ? -1
                    : a.id > b.id
                      ? 1
                      : 0)
            );
          });
        const pages = [];
        for (const offset of [0, 2]) {
          const result = await listing({
            q: prefix,
            sort,
            offset: String(offset),
            limit: '2',
          });
          expect(result.status).toBe(200);
          expect(result.body.data).toMatchObject({
            offset,
            limit: 2,
            total: 4,
          });
          pages.push(...result.body.data.items.map((row) => row.id));
        }
        expect(pages).toEqual(expected.map((row) => row.id));
        expect(
          (await listing({ q: prefix, sort, offset: '1000000', limit: '100' }))
            .body.data,
        ).toMatchObject({ items: [], total: 4, offset: 1000000, limit: 100 });
      },
    );

    test('inclusive exact VND bounds, description search and default name order share the same filtered count', async () => {
      const result = await listing({
        q: `  ${prefix}  `,
        minPriceVnd: '9007199254740992',
        maxPriceVnd: '9007199254740993',
        limit: '1',
      });
      expect(result.status).toBe(200);
      expect(result.body.data.total).toBe(2);
      expect(result.body.data.items).toHaveLength(1);
      const ids = rows
        .slice(0, 2)
        .map((row) => row.id)
        .sort();
      expect(result.body.data.items[0].id).toBe(ids[0]);
      const match = await listing({
        q: 'CASE-SENSITIVE TEXT IS SEARCHABLE',
        minPriceVnd: '2',
        maxPriceVnd: '2',
      });
      expect(match.body.data.total).toBe(1);
      expect(match.body.data.items[0].id).toBe(rows[2].id);
      const inverted = await listing({
        minPriceVnd: '9007199254740993',
        maxPriceVnd: '9007199254740992',
      });
      expect(inverted.status).toBe(400);
      expect(inverted.body.error.code).toBe('VALIDATION_FAILED');
    });

    test('search escapes wildcard/escape characters and binds quotes/injection text literally', async () => {
      const marker = 'literal-' + randomUUID();
      const literals = ['%sale', '_sale', '!sale', '\\sale', "O'Reilly"];
      const fixtures = [];
      for (const suffix of [...literals, 'Xsale'])
        fixtures.push(await fixture({ name: marker + suffix }));
      for (const [index, suffix] of literals.entries()) {
        const result = await listing({ q: marker + suffix });
        expect(result.status).toBe(200);
        expect(result.body.data.total).toBe(1);
        expect(result.body.data.items[0].id).toBe(fixtures[index].id);
      }
      const injected = await listing({ q: "' OR 1=1 --" });
      expect(injected.status).toBe(200);
      expect(injected.body.data).toMatchObject({ items: [], total: 0 });
      expect(
        (await source.query('SELECT count(*)::int AS count FROM products'))[0]
          .count,
      ).toBeGreaterThan(0);
    });

    test('invalid filters/sorts, unknown keys, pagination and query arrays fail safely', async () => {
      for (const query of [
        'sort=name;DROP%20TABLE%20products',
        'sort=stockAvailable',
        'sort=price_vnd',
        'isActive=false',
        'role=ADMIN',
        'categoryId=x',
        'q=',
        'q=%20',
        'q=' + 'a'.repeat(101),
        'limit=0',
        'limit=101',
        'limit=1.5',
        'limit=1e2',
        'limit=02',
        'limit=2&limit=3',
        'offset=-1',
        'offset=1000001',
        'offset=NaN',
        'minPriceVnd=0',
        'maxPriceVnd=1.5',
        'minPriceVnd=1e3',
        'minPriceVnd=9223372036854775808',
        'minPriceVnd=1&minPriceVnd=2',
        'q[a]=x',
      ]) {
        const result = await request('GET', '/products?' + query);
        expect(result.status).toBe(400);
        expect(result.body.error.code).toBe('VALIDATION_FAILED');
      }
      expect((await request('GET', '/products/not-a-uuid')).status).toBe(400);
      expect(
        (await request('GET', `/products/${rows[0].id}?isActive=false`)).status,
      ).toBe(400);
    });

    test('ADMIN create accepts bigint maximum and integer stock bounds with defaults and safe serialization', async () => {
      for (const initialStock of [0, 2147483647]) {
        const result = await request(
          'POST',
          '/products',
          {
            name: '  Created catalog  ',
            description: '  Details  ',
            priceVnd: '9223372036854775807',
            initialStock,
          },
          'ADMIN',
        );
        expect(result.status).toBe(201);
        safeProduct(result.body.data);
        expect(result.body.data).toMatchObject({
          name: 'Created catalog',
          description: 'Details',
          priceVnd: '9223372036854775807',
          stockAvailable: initialStock,
          isActive: true,
          imageUrl: null,
        });
        const stored = await dbRow(result.body.data.id);
        expect(stored).toMatchObject({
          price_vnd: '9223372036854775807',
          stock_available: initialStock,
          image_path: null,
        });
        expect(
          (
            await source.query(
              'SELECT count(*)::int AS count FROM inventory_adjustment_audit WHERE product_id=$1',
              [stored.id],
            )
          )[0].count,
        ).toBe(0);
      }
      const inactive = await request(
        'POST',
        '/products',
        {
          name: 'Inactive create',
          priceVnd: '1',
          initialStock: 0,
          isActive: false,
        },
        'ADMIN',
      );
      expect(inactive.status).toBe(201);
      expect(inactive.body.data.description).toBeNull();
      expect(
        (
          await request(
            'GET',
            `/products/${inactive.body.data.id}`,
            undefined,
            'ADMIN',
          )
        ).status,
      ).toBe(404);
    });

    test('money/stock/boolean/text and protected create input cannot persist partial records', async () => {
      const valid = {
        name: 'Invalid create marker',
        priceVnd: '1',
        initialStock: 0,
      };
      const before = (
        await source.query('SELECT count(*)::int AS count FROM products')
      )[0].count;
      const inputs = [];
      for (const priceVnd of [
        0,
        -1,
        1.5,
        9007199254740992,
        '0',
        '-1',
        '1.5',
        '1e3',
        '01',
        ' 1',
        '1 ',
        'NaN',
        'Infinity',
        '9223372036854775808',
        null,
      ])
        inputs.push({ ...valid, priceVnd });
      for (const initialStock of [-1, 1.5, 2147483648, '1', null])
        inputs.push({ ...valid, initialStock });
      for (const field of [
        'stockAvailable',
        'imagePath',
        'imageUrl',
        'id',
        'role',
        'categoryId',
      ])
        inputs.push({ ...valid, [field]: 'protected' });
      for (const [field, value] of Object.entries({
        stockAvailable: 0,
        imagePath: 'products/client.png',
        imageUrl: '/api/v1/products/client/image',
        id: randomUUID(),
        role: 'ADMIN',
        categoryId: randomUUID(),
      }))
        inputs.push({ ...valid, [field]: value });
      inputs.push(
        { ...valid, isActive: null },
        { ...valid, isActive: 'false' },
        { ...valid, name: '' },
        { ...valid, name: 'a'.repeat(251) },
        { ...valid, description: '' },
        { ...valid, description: 'a'.repeat(10001) },
        { ...valid, name: 'Control\nname' },
      );
      for (const input of inputs)
        expect(
          (await request('POST', '/products', input, 'ADMIN')).status,
        ).toBe(400);
      expect(
        (await source.query('SELECT count(*)::int AS count FROM products'))[0]
          .count,
      ).toBe(before);
    });

    test('catalog PATCH can edit/reactivate inactive product but preserves stock/image and never inserts inventory audit', async () => {
      const product = await fixture({
        name: 'Before',
        price: '2',
        stock: 17,
        active: false,
        image: 'products/retained.png',
      });
      const before = await dbRow(product.id);
      const body = {
        name: '  After  ',
        description: '  Description  ',
        priceVnd: '9007199254740993',
        isActive: true,
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await request(
          'PATCH',
          `/products/${product.id}`,
          body,
          'ADMIN',
        );
        expect(result.status).toBe(200);
        safeProduct(result.body.data);
        expect(result.body.data).toMatchObject({
          name: 'After',
          description: 'Description',
          priceVnd: '9007199254740993',
          stockAvailable: 17,
          imageUrl: `/api/v1/products/${product.id}/image`,
          isActive: true,
        });
        const stored = await dbRow(product.id);
        expect(stored.stock_available).toBe(before.stock_available);
        expect(stored.image_path).toBe(before.image_path);
        expect(stored.created_at).toEqual(before.created_at);
      }
      expect(
        (
          await source.query(
            'SELECT count(*)::int AS count FROM inventory_adjustment_audit WHERE product_id=$1',
            [product.id],
          )
        )[0].count,
      ).toBe(0);
      expect((await request('GET', `/products/${product.id}`)).status).toBe(
        200,
      );
      const cleared = await request(
        'PATCH',
        `/products/${product.id}`,
        { description: null, isActive: false },
        'ADMIN',
      );
      expect(cleared.status).toBe(200);
      expect(cleared.body.data.description).toBeNull();
      expect((await request('GET', `/products/${product.id}`)).status).toBe(
        404,
      );
    });

    test('PATCH rejects stock/image/protected/invalid catalog fields without touching stored row', async () => {
      const product = await fixture({
        name: 'Untouched',
        price: '10',
        stock: 12,
        image: 'products/retained.png',
      });
      const before = await dbRow(product.id);
      const inputs = [];
      for (const field of [
        'initialStock',
        'stockAvailable',
        'imagePath',
        'imageUrl',
        'id',
        'role',
        'categoryId',
        'createdAt',
      ])
        inputs.push({ [field]: 'protected' });
      for (const [field, value] of Object.entries({
        initialStock: 12,
        stockAvailable: 12,
        imagePath: 'products/retained.png',
        imageUrl: `/api/v1/products/${product.id}/image`,
        id: product.id,
        role: 'ADMIN',
        categoryId: randomUUID(),
      }))
        inputs.push({ [field]: value });
      inputs.push({ stockAvailable: 0 }, { imagePath: 'products/client.png' });
      for (const priceVnd of [
        3.5,
        9007199254740992,
        '9223372036854775808',
        '0',
        '1.1',
        '01',
        null,
      ])
        inputs.push({ priceVnd });
      inputs.push(
        { name: null },
        { name: '' },
        { isActive: null },
        { isActive: 'false' },
        { description: '' },
      );
      for (const body of inputs)
        expect(
          (await request('PATCH', `/products/${product.id}`, body, 'ADMIN'))
            .status,
        ).toBe(400);
      expect(
        (await request('PATCH', `/products/${product.id}`, {}, 'ADMIN')).body
          .error.code,
      ).toBe('EMPTY_UPDATE');
      expect(await dbRow(product.id)).toEqual(before);
      expect(
        (
          await request(
            'PATCH',
            `/products/${randomUUID()}`,
            { name: 'Missing' },
            'ADMIN',
          )
        ).body.error.code,
      ).toBe('NOT_FOUND');
    });

    test('PATCH rereads product after a real lock wait and retains concurrently changed stock/image', async () => {
      const product = await fixture({ name: 'Before contention', stock: 9 });
      const runner = source.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      await runner.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [
        product.id,
      ]);
      const pending = request(
        'PATCH',
        `/products/${product.id}`,
        { name: 'After contention' },
        'ADMIN',
      );
      try {
        const deadline = Date.now() + 12000;
        let observed = false;
        while (Date.now() < deadline) {
          const waiters = await source.query(
            "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%products%' AND query LIKE '%FOR UPDATE%'",
          );
          if (waiters[0].count > 0) {
            observed = true;
            break;
          }
          await delay(15);
        }
        expect(observed).toBe(true);
        await runner.query(
          "UPDATE products SET stock_available=3,image_path='products/concurrent.png' WHERE id=$1",
          [product.id],
        );
        await runner.commitTransaction();
        const result = await pending;
        expect(result.status).toBe(200);
        expect(result.body.data.stockAvailable).toBe(3);
        expect(await dbRow(product.id)).toMatchObject({
          name: 'After contention',
          stock_available: 3,
          image_path: 'products/concurrent.png',
        });
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await Promise.allSettled([pending]);
      }
    });

    test('actual Swagger exposes catalog and dedicated image/inventory security without P1 routes', async () => {
      const spec = await (await fetch(app.base + '/api/docs-json')).json();
      expect(spec.paths['/api/v1/products'].get.security).toBeUndefined();
      expect(spec.paths['/api/v1/products'].post.security).toEqual([
        { bearer: [] },
      ]);
      expect(spec.paths['/api/v1/products/{id}'].patch.security).toEqual([
        { bearer: [] },
      ]);
      expect(spec.paths['/api/v1/products/{id}/image'].post.security).toEqual([
        { bearer: [] },
      ]);
      expect(
        spec.paths['/api/v1/products/{id}/stock-adjustments'].post.security,
      ).toEqual([{ bearer: [] }]);
      expect(spec.paths['/api/v1/categories']).toBeUndefined();
      expect(spec.paths['/api/v1/cart']).toBeUndefined();
    });
  });
}

module.exports = { registerProductCases };
