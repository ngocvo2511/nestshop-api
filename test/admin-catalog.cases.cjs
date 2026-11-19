const {
  describe,
  beforeAll,
  afterAll,
  test,
  expect,
} = require('@jest/globals');
const { randomUUID, randomBytes } = require('node:crypto');
const { startBuiltApplication } = require('./helpers/app-process.cjs');

function registerAdminCatalogCases(getSource, appDatabase) {
  describe('Admin catalog visibility and inventory history', () => {
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

    test('admin catalog includes inactive products and inventory history is ordered, paginated and persistent', async () => {
      const name = 'management-' + randomUUID();
      const product = await request(
        'POST',
        '/products',
        { name, priceVnd: '10000', initialStock: 10 },
        admin.accessToken,
      );
      expect(product.status).toBe(201);
      const id = product.body.data.id;
      const path = `/products/${id}/stock-adjustments`;
      expect(
        (await request('GET', path, undefined, admin.accessToken)).body.data
          .total,
      ).toBe(0);
      const first = await request(
        'POST',
        path,
        { quantityDelta: 5, reason: 'Received goods' },
        admin.accessToken,
      );
      const second = await request(
        'POST',
        path,
        { quantityDelta: -2, reason: 'Damaged goods' },
        admin.accessToken,
      );
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      await source.query(
        'UPDATE inventory_adjustment_audit SET created_at=$2 WHERE product_id=$1',
        [id, new Date()],
      );
      const history = await request(
        'GET',
        path + '?limit=1&offset=0',
        undefined,
        admin.accessToken,
      );
      expect(history.status).toBe(200);
      expect(history.body.data).toMatchObject({
        limit: 1,
        offset: 0,
        total: 2,
      });
      const expected = [first.body.data.id, second.body.data.id]
        .sort()
        .reverse();
      expect(history.body.data.items[0].id).toBe(expected[0]);
      expect(
        (
          await request(
            'GET',
            path + '?limit=1&offset=1',
            undefined,
            admin.accessToken,
          )
        ).body.data.items[0].id,
      ).toBe(expected[1]);
      expect(
        (await request('GET', path + '?limit=0', undefined, admin.accessToken))
          .status,
      ).toBe(400);
      expect(
        (
          await request(
            'GET',
            `/products/${randomUUID()}/stock-adjustments`,
            undefined,
            admin.accessToken,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await request(
            'PATCH',
            `/products/${id}`,
            { isActive: false },
            admin.accessToken,
          )
        ).status,
      ).toBe(200);
      expect((await request('GET', `/products/${id}`)).status).toBe(404);
      expect(
        (await request('GET', `/products?q=${name}`)).body.data.total,
      ).toBe(0);
      expect(
        (
          await request(
            'GET',
            `/admin/products?q=${name}`,
            undefined,
            admin.accessToken,
          )
        ).body.data.total,
      ).toBe(1);
      expect(
        (
          await request(
            'GET',
            `/admin/products?q=${name}&status=inactive`,
            undefined,
            admin.accessToken,
          )
        ).body.data.total,
      ).toBe(1);
      expect(
        (
          await request(
            'GET',
            `/admin/products?q=${name}&status=active`,
            undefined,
            admin.accessToken,
          )
        ).body.data.total,
      ).toBe(0);
      expect(
        (
          await request(
            'GET',
            `/admin/products/${id}`,
            undefined,
            admin.accessToken,
          )
        ).body.data.isActive,
      ).toBe(false);
      expect(
        (await request('GET', path, undefined, admin.accessToken)).body.data
          .total,
      ).toBe(2);
      expect(
        (
          await request(
            'PATCH',
            `/products/${id}`,
            { isActive: true },
            admin.accessToken,
          )
        ).status,
      ).toBe(200);
      expect(
        (await request('GET', `/products/${id}`)).body.data.stockAvailable,
      ).toBe(13);
    });
    test('new administrative routes reject guests, customers and staff', async () => {
      const staff = await account('STAFF');
      const routes = [
        ['GET', '/admin/products'],
        ['GET', `/admin/products/${randomUUID()}`],
        ['GET', `/products/${randomUUID()}/stock-adjustments`],
      ];
      for (const [method, path, body] of routes) {
        expect((await request(method, path, body)).status).toBe(401);
        for (const token of [customer.accessToken, staff.accessToken])
          expect((await request(method, path, body, token)).status).toBe(403);
      }
    });
  });
}
module.exports = { registerAdminCatalogCases };
