const {
  describe,
  beforeAll,
  afterAll,
  test,
  expect,
} = require('@jest/globals');
const { randomUUID, randomBytes } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { startBuiltApplication } = require('./helpers/app-process.cjs');

function registerCheckoutCases(getSource, appDatabase) {
  describe('Day8 atomic checkout API on PostgreSQL', () => {
    let source;
    let app;
    const actors = {};
    const shipping = {
      recipientName: 'Checkout recipient',
      recipientPhone: '+84901234567',
      addressLine: 'Delivery address',
      provinceCity: 'Delivery city',
    };
    beforeAll(async () => {
      source = getSource();
      app = await startBuiltApplication(appDatabase());
      for (const [name, role] of [
        ['A', 'CUSTOMER'],
        ['B', 'CUSTOMER'],
        ['STAFF', 'STAFF'],
        ['ADMIN', 'ADMIN'],
      ]) {
        const credentials = {
          email: `${randomUUID()}@checkout.invalid`,
          password: randomBytes(24).toString('hex'),
        };
        const registered = await request(
          'POST',
          '/auth/register',
          credentials,
          null,
        );
        expect(registered.status).toBe(201);
        const id = registered.body.data.id;
        if (role !== 'CUSTOMER')
          await source.query('UPDATE users SET role=$2 WHERE id=$1', [
            id,
            role,
          ]);
        const login = await request('POST', '/auth/login', credentials, null);
        expect(login.status).toBe(200);
        actors[name] = { id, token: login.body.data.accessToken, credentials };
      }
    });
    afterAll(async () => {
      await app?.close();
    });
    async function request(
      method,
      path,
      body,
      actor = 'A',
      base = app.base,
      token = actor ? actors[actor]?.token : undefined,
    ) {
      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = 'Bearer ' + token;
      const response = await fetch(base + '/api/v1' + path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: await response.json(),
        cache: response.headers.get('cache-control'),
      };
    }
    async function product(price = '10', stock = 10, active = true) {
      const id = randomUUID();
      await source.query(
        'INSERT INTO products (id,name,price_vnd,stock_available,is_active) VALUES ($1,$2,$3,$4,$5)',
        [id, 'Snapshot ' + id, price, stock, active],
      );
      return id;
    }
    async function row(id) {
      return (
        await source.query('SELECT * FROM products WHERE id=$1', [id])
      )[0];
    }
    async function counts(actor = 'A') {
      return (
        await source.query(
          `SELECT
        (SELECT count(*)::int FROM orders WHERE user_id=$1) AS orders,
        (SELECT count(*)::int FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.user_id=$1) AS items,
        (SELECT count(*)::int FROM order_status_history h JOIN orders o ON o.id=h.order_id WHERE o.user_id=$1) AS history,
        (SELECT count(*)::int FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.user_id=$1) AS payments`,
          [actors[actor].id],
        )
      )[0];
    }
    async function orderState(id) {
      return {
        order: (
          await source.query('SELECT * FROM orders WHERE id=$1', [id])
        )[0],
        items: await source.query(
          'SELECT * FROM order_items WHERE order_id=$1 ORDER BY product_id',
          [id],
        ),
        history: await source.query(
          'SELECT * FROM order_status_history WHERE order_id=$1 ORDER BY created_at,id',
          [id],
        ),
        payments: await source.query(
          'SELECT * FROM payments WHERE order_id=$1',
          [id],
        ),
      };
    }
    const item = (productId, quantity = 1) => ({ productId, quantity });
    const checkout = (items, actor = 'A', address = shipping) =>
      request('POST', '/orders', { items, shipping: address }, actor);
    async function block(id) {
      const runner = source.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      await runner.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [
        id,
      ]);
      return runner;
    }
    async function waitProducts(count) {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        const result = await source.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%products%' AND query LIKE '%FOR UPDATE%'",
        );
        if (result[0].count >= count) return;
        await delay(15);
      }
      throw new Error('Expected independent checkout product-lock waiters');
    }
    async function twoQueued(id, first, second) {
      const runner = await block(id);
      const pending = [];
      try {
        pending.push(first());
        await waitProducts(1);
        pending.push(second());
        await waitProducts(2);
        await runner.commitTransaction();
        return await Promise.all(pending);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await Promise.allSettled(pending);
      }
    }

    test.each([null, 'STAFF', 'ADMIN'])(
      '%s cannot checkout or reserve stock',
      async (actor) => {
        const id = await product();
        const before = await row(id);
        expect((await checkout([item(id)], actor)).status).toBe(
          actor ? 403 : 401,
        );
        expect(await row(id)).toEqual(before);
        if (actor) expect((await counts(actor)).orders).toBe(0);
      },
    );

    test('CUSTOMER exact totals/generated lines, shipping snapshots, initial SYSTEM history and60-minute reservation commit together', async () => {
      const a = await product('9007199254740993', 5);
      const b = await product('3', 10);
      const result = await checkout(
        [item(b, 3), item(a.toUpperCase(), 2)],
        'A',
        {
          ...shipping,
          recipientName: '  Checkout recipient  ',
          ward: ' Ward ',
          district: null,
        },
      );
      expect(result.status).toBe(201);
      expect(result.cache).toBe('no-store');
      const data = result.body.data;
      expect(Object.keys(data).sort()).toEqual(
        [
          'id',
          'status',
          'totalVnd',
          'createdAt',
          'updatedAt',
          'reservationExpiresAt',
          'paymentSummary',
          'shipping',
          'items',
        ].sort(),
      );
      expect(data).toMatchObject({
        status: 'PENDING_PAYMENT',
        totalVnd: '18014398509481995',
        paymentSummary: { latestAttempt: null, successfulAttempt: null },
        shipping: {
          ...shipping,
          ward: 'Ward',
          district: null,
          postalCode: null,
        },
      });
      expect(data.items.map((entry) => entry.productId)).toEqual([a, b].sort());
      expect(data.items.find((entry) => entry.productId === a)).toMatchObject({
        unitPriceVnd: '9007199254740993',
        lineTotalVnd: '18014398509481986',
        quantity: 2,
      });
      expect(
        new Date(data.reservationExpiresAt) - new Date(data.createdAt),
      ).toBe(3600000);
      const state = await orderState(data.id);
      expect(state.order).toMatchObject({
        user_id: actors.A.id,
        status: 'PENDING_PAYMENT',
        total_vnd: '18014398509481995',
        recipient_name: shipping.recipientName,
        ward: 'Ward',
        district: null,
        postal_code: null,
      });
      expect(state.items.map((entry) => entry.line_total_vnd).sort()).toEqual(
        ['18014398509481986', '9'].sort(),
      );
      expect(state.history).toHaveLength(1);
      expect(state.history[0]).toMatchObject({
        previous_status: null,
        new_status: 'PENDING_PAYMENT',
        actor_user_id: null,
        note: null,
      });
      expect(state.history[0].created_at).toEqual(state.order.created_at);
      expect(state.payments).toHaveLength(0);
      expect((await row(a)).stock_available).toBe(3);
      expect((await row(b)).stock_available).toBe(7);
      expect(
        (
          await source.query(
            'SELECT count(*)::int AS count FROM inventory_adjustment_audit WHERE product_id IN ($1,$2)',
            [a, b],
          )
        )[0].count,
      ).toBe(0);
      const edited = await request(
        'PATCH',
        `/products/${a}`,
        { name: 'Changed after checkout', priceVnd: '1', isActive: false },
        'ADMIN',
      );
      expect(edited.status).toBe(200);
      expect(
        (
          await request(
            'PATCH',
            '/users/me',
            { fullName: 'Changed profile', phoneNumber: '+84909999999' },
            'A',
          )
        ).status,
      ).toBe(200);
      expect(await orderState(data.id)).toEqual(state);
      expect(
        JSON.stringify(result.body).includes(actors.A.credentials.password),
      ).toBe(false);
      expect(app.output().includes(actors.A.token)).toBe(false);
    });

    test('shipping/bad items/duplicate IDs/protected client amounts reject without partial writes', async () => {
      const id = await product();
      const valid = { items: [item(id)], shipping };
      const before = await counts();
      const beforeProduct = await row(id);
      const bad = [
        { ...valid, items: [] },
        { ...valid, items: null },
        { ...valid, items: [null] },
        { ...valid, items: [[item(id)]] },
        { ...valid, items: [item('invalid')] },
        { ...valid, items: [item(id, 0)] },
        { ...valid, items: [item(id, -1)] },
        { ...valid, items: [item(id, 1.5)] },
        { ...valid, items: [item(id, '1')] },
        { ...valid, items: [item(id, 2147483648)] },
        { ...valid, items: [item(id), item(id.toUpperCase())] },
        {
          ...valid,
          items: Array.from({ length: 101 }, () => item(randomUUID())),
        },
        { ...valid, shipping: null },
        { items: [item(id)] },
        { ...valid, shipping: [shipping] },
        { ...valid, shipping: { ...shipping, recipientName: '' } },
        { ...valid, shipping: { ...shipping, recipientName: 'a'.repeat(201) } },
        { ...valid, shipping: { ...shipping, recipientPhone: '123' } },
        { ...valid, shipping: { ...shipping, recipientPhone: 84901234567 } },
        { ...valid, shipping: { ...shipping, addressLine: ' ' } },
        { ...valid, shipping: { ...shipping, provinceCity: '' } },
        { ...valid, shipping: { ...shipping, ward: '' } },
      ];
      for (const [field, value] of Object.entries({
        userId: actors.B.id,
        totalVnd: '1',
        status: 'PAID',
        reservationExpiresAt: '2099-01-01',
        addressId: randomUUID(),
        cartId: randomUUID(),
      }))
        bad.push({ ...valid, [field]: value });
      for (const [field, value] of Object.entries({
        priceVnd: '1',
        unitPriceVnd: '1',
        lineTotalVnd: '1',
        productName: 'Client snapshot',
        stockAvailable: 999,
      }))
        bad.push({ ...valid, items: [{ ...item(id), [field]: value }] });
      bad.push({ ...valid, shipping: { ...shipping, userId: actors.B.id } });
      for (const body of bad) {
        const result = await request('POST', '/orders', body);
        expect(result.status).toBe(400);
        expect(result.body.error.code).toBe('VALIDATION_FAILED');
      }
      expect((await request('POST', '/orders?totalVnd=1', valid)).status).toBe(
        400,
      );
      expect(await counts()).toEqual(before);
      expect(await row(id)).toEqual(beforeProduct);
    });

    test.each(['missing', 'inactive', 'insufficient'])(
      '%s product yields generic insufficient-stock rejection and no reservation',
      async (kind) => {
        const good = await product();
        const bad =
          kind === 'missing'
            ? randomUUID()
            : await product(
                '1',
                kind === 'insufficient' ? 0 : 10,
                kind !== 'inactive',
              );
        const before = await counts();
        const previous = await row(good);
        const result = await checkout([item(good), item(bad)]);
        expect(result.status).toBe(409);
        expect(result.body.error.code).toBe('INSUFFICIENT_STOCK');
        expect(await row(good)).toEqual(previous);
        expect(await counts()).toEqual(before);
      },
    );

    test('line multiplication and cumulative sum overflow reject before stock changes; bigint maximum is accepted', async () => {
      const max = await product('9223372036854775807', 2);
      const one = await product('1', 2);
      const before = await counts();
      for (const items of [[item(max, 2)], [item(max), item(one)]]) {
        const result = await checkout(items);
        expect(result.status).toBe(400);
        expect(result.body.error.code).toBe('MONEY_LIMIT_EXCEEDED');
        expect(await counts()).toEqual(before);
        expect((await row(max)).stock_available).toBe(2);
        expect((await row(one)).stock_available).toBe(2);
      }
      const accepted = await checkout([item(max)]);
      expect(accepted.status).toBe(201);
      expect(accepted.body.data.totalVnd).toBe('9223372036854775807');
      expect(accepted.body.data.items[0].lineTotalVnd).toBe(
        '9223372036854775807',
      );
    });

    test('accepts100 distinct products and maximum integer quantity without cart/payment coupling', async () => {
      const ids = Array.from({ length: 100 }, () => randomUUID());
      await source.query(
        "INSERT INTO products (id,name,price_vnd,stock_available) SELECT id,'Boundary product',1,1 FROM unnest($1::uuid[]) AS id",
        [ids],
      );
      const many = await checkout(ids.map((id) => item(id)));
      expect(many.status).toBe(201);
      expect(many.body.data.items).toHaveLength(100);
      expect(many.body.data.totalVnd).toBe('100');
      expect((await orderState(many.body.data.id)).history).toHaveLength(1);
      const id = await product('1', 2147483647);
      const maximum = await checkout([item(id, 2147483647)]);
      expect(maximum.status).toBe(201);
      expect(maximum.body.data.totalVnd).toBe('2147483647');
      expect((await row(id)).stock_available).toBe(0);
      expect((await orderState(maximum.body.data.id)).payments).toHaveLength(0);
    });

    test('reservation lifetime comes from environment rather than fixed60 minutes', async () => {
      const other = await startBuiltApplication(appDatabase(), {
        orderReservationSeconds: 73,
      });
      try {
        const login = await request(
          'POST',
          '/auth/login',
          actors.A.credentials,
          null,
          other.base,
        );
        const id = await product();
        const result = await request(
          'POST',
          '/orders',
          { items: [item(id)], shipping },
          'A',
          other.base,
          login.body.data.accessToken,
        );
        expect(result.status).toBe(201);
        expect(
          new Date(result.body.data.reservationExpiresAt) -
            new Date(result.body.data.createdAt),
        ).toBe(73000);
        const state = await orderState(result.body.data.id);
        expect(
          state.order.reservation_expires_at - state.order.created_at,
        ).toBe(73000);
      } finally {
        await other.close();
      }
    });

    test.each(['latest', 'inactive'])(
      'checkout reloads %s product state and clock after waiting for lock',
      async (kind) => {
        const id = await product('2', 5);
        const before = await counts();
        const runner = await block(id);
        const pending = checkout([item(id, 2)]);
        try {
          await waitProducts(1);
          await runner.query(
            'UPDATE products SET name=$2,price_vnd=$3,stock_available=3,is_active=$4 WHERE id=$1',
            [id, 'Latest locked snapshot', '9', kind !== 'inactive'],
          );
          const marker = (
            await runner.query('SELECT clock_timestamp() AS time')
          )[0].time;
          await runner.commitTransaction();
          const result = await pending;
          if (kind === 'latest') {
            expect(result.status).toBe(201);
            expect(result.body.data.totalVnd).toBe('18');
            expect(result.body.data.items[0]).toMatchObject({
              productName: 'Latest locked snapshot',
              unitPriceVnd: '9',
            });
            expect(
              new Date(result.body.data.createdAt).getTime(),
            ).toBeGreaterThanOrEqual(marker.getTime());
            expect((await row(id)).stock_available).toBe(1);
          } else {
            expect(result.body.error.code).toBe('INSUFFICIENT_STOCK');
            expect(await counts()).toEqual(before);
            expect((await row(id)).stock_available).toBe(3);
          }
        } finally {
          if (runner.isTransactionActive) await runner.rollbackTransaction();
          await runner.release();
          await Promise.allSettled([pending]);
        }
      },
    );

    test.each(['stock', 'item', 'history'])(
      'failure after partial %s persistence rolls back every deduction/order/line/history',
      async (stage) => {
        const ids = [await product('10', 10), await product('20', 10)].sort();
        const beforeProducts = await Promise.all(ids.map(row));
        const before = await counts();
        const constraint = 'checkout_fault_' + randomBytes(8).toString('hex');
        const table =
          stage === 'stock'
            ? 'products'
            : stage === 'item'
              ? 'order_items'
              : 'order_status_history';
        const check =
          stage === 'stock'
            ? `id <> '${ids[1]}'::uuid OR stock_available=10`
            : stage === 'item'
              ? `product_id <> '${ids[1]}'::uuid`
              : 'note IS NOT NULL';
        await source.query(
          `ALTER TABLE ${table} ADD CONSTRAINT ${constraint} CHECK (${check}) NOT VALID`,
        );
        try {
          const result = await checkout(ids.map((id) => item(id, 2)));
          expect(result.status).toBe(500);
          expect(result.body.error.code).toBe('INTERNAL_ERROR');
          expect(JSON.stringify(result.body).includes(constraint)).toBe(false);
          expect(await counts()).toEqual(before);
          expect(await Promise.all(ids.map(row))).toEqual(beforeProducts);
          expect(
            (
              await source.query(
                'SELECT count(*)::int AS count FROM order_items WHERE product_id = ANY($1::uuid[])',
                [ids],
              )
            )[0].count,
          ).toBe(0);
        } finally {
          await source.query(
            `ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`,
          );
        }
        expect((await checkout(ids.map((id) => item(id)))).status).toBe(201);
      },
    );

    test('actual product lock order is ascending UUID even when request order is reversed', async () => {
      const ids = [await product(), await product()].sort();
      const blocker = await block(ids[1]);
      const probe = source.createQueryRunner();
      const pending = checkout([item(ids[1]), item(ids[0])]);
      try {
        await waitProducts(1);
        await probe.connect();
        await probe.startTransaction();
        await expect(
          probe.query('SELECT id FROM products WHERE id=$1 FOR UPDATE NOWAIT', [
            ids[0],
          ]),
        ).rejects.toMatchObject({ driverError: { code: '55P03' } });
        await probe.rollbackTransaction();
        await blocker.commitTransaction();
        expect((await pending).status).toBe(201);
      } finally {
        if (probe.isTransactionActive) await probe.rollbackTransaction();
        await probe.release();
        if (blocker.isTransactionActive) await blocker.rollbackTransaction();
        await blocker.release();
        await Promise.allSettled([pending]);
      }
    });

    test.each([1, 2])(
      'two independent customers competing for last stock across %s product(s) have one winner and no partial records',
      async (size) => {
        const ids = [];
        for (let index = 0; index < size; index++)
          ids.push(await product('10', 1));
        ids.sort();
        const beforeA = await counts('A');
        const beforeB = await counts('B');
        const results = await twoQueued(
          ids[0],
          () =>
            checkout(
              ids.map((id) => item(id)),
              'A',
            ),
          () =>
            checkout(
              [...ids].reverse().map((id) => item(id)),
              'B',
            ),
        );
        expect(results.map((entry) => entry.status).sort()).toEqual([201, 409]);
        expect(
          results.find((entry) => entry.status === 409).body.error.code,
        ).toBe('INSUFFICIENT_STOCK');
        for (const [index, actor] of ['A', 'B'].entries()) {
          const before = actor === 'A' ? beforeA : beforeB;
          const after = await counts(actor);
          const won = results[index].status === 201;
          expect(after).toEqual({
            orders: before.orders + (won ? 1 : 0),
            items: before.items + (won ? size : 0),
            history: before.history + (won ? 1 : 0),
            payments: before.payments,
          });
        }
        for (const id of ids) expect((await row(id)).stock_available).toBe(0);
        const winner = results.find((entry) => entry.status === 201).body.data;
        const state = await orderState(winner.id);
        expect(state.items).toHaveLength(size);
        expect(state.history).toHaveLength(1);
        expect(state.payments).toHaveLength(0);
        expect(state.order.status).toBe('PENDING_PAYMENT');
      },
    );

    test('checkout and audited inventory adjustment serialize on the same product row without lost updates', async () => {
      const id = await product('10', 3);
      const results = await twoQueued(
        id,
        () => checkout([item(id, 2)]),
        () =>
          request(
            'POST',
            `/products/${id}/stock-adjustments`,
            { quantityDelta: 4, reason: 'After checkout' },
            'ADMIN',
          ),
      );
      expect(results.map((entry) => entry.status)).toEqual([201, 201]);
      expect((await row(id)).stock_available).toBe(5);
      const audits = await source.query(
        'SELECT * FROM inventory_adjustment_audit WHERE product_id=$1',
        [id],
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        previous_stock: 1,
        new_stock: 5,
        quantity_delta: 4,
      });
      expect((await orderState(results[0].body.data.id)).history).toHaveLength(
        1,
      );
    });

    async function reserved() {
      const ids = [await product(), await product()].sort();
      const result = await checkout(ids.map((id) => item(id, 2)));
      expect(result.status).toBe(201);
      const id = result.body.data.id;
      await source.query(
        "INSERT INTO payments (id,order_id,provider_reference,amount_vnd,payment_url,expires_at) VALUES ($1,$2,$3,40,$4,clock_timestamp()+interval '20 minutes')",
        [
          randomUUID(),
          id,
          randomUUID(),
          'https://sensitive.invalid/signed-secret',
        ],
      );
      return { id, ids };
    }
    const cancel = (id, actor = 'A') =>
      request('POST', `/orders/${id}/cancel`, {}, actor);
    async function waitOrders(n) {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        const rows = await source.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%orders%' AND query LIKE '%FOR UPDATE%'",
        );
        if (rows[0].n >= n) return;
        await delay(15);
      }
      throw new Error('Order lock waiters missing');
    }
    test('Day9 ownership, safe summaries, pagination, filters and USER history', async () => {
      const { id, ids } = await reserved();
      for (const path of [`/orders/${id}`, `/orders/${id}/history`]) {
        expect((await request('GET', path, undefined, 'B')).status).toBe(404);
        expect(
          (await request('GET', path.replace(id, randomUUID()), undefined))
            .status,
        ).toBe(404);
        for (const actor of [null, 'STAFF', 'ADMIN'])
          expect((await request('GET', path, undefined, actor)).status).toBe(
            actor ? 403 : 401,
          );
      }
      expect((await cancel(id, 'B')).status).toBe(404);
      for (const actor of [null, 'STAFF', 'ADMIN'])
        expect((await cancel(id, actor)).status).toBe(actor ? 403 : 401);
      const detail = await request('GET', `/orders/${id}`, undefined);
      expect(detail.cache).toBe('no-store');
      expect(detail.body.data.items).toHaveLength(2);
      expect(detail.body.data.paymentSummary.latestAttempt.status).toBe(
        'PENDING',
      );
      const list = await request(
        'GET',
        '/orders?limit=100&sort=createdAt&status=PENDING_PAYMENT',
        undefined,
      );
      expect(list.body.data.items.some((o) => o.id === id)).toBe(true);
      expect(JSON.stringify([detail.body, list.body])).not.toMatch(
        /signed-secret|paymentUrl|providerTransactionReference|responseCode/,
      );
      const foreignList = await request(
        'GET',
        '/orders?limit=100',
        undefined,
        'B',
      );
      expect(foreignList.body.data.items.some((o) => o.id === id)).toBe(false);
      for (const query of [
        'limit=0',
        'offset=-1',
        'status=INVALID',
        'sort=id',
        'userId=' + actors.B.id,
        'limit=1&limit=2',
      ])
        expect(
          (await request('GET', '/orders?' + query, undefined)).status,
        ).toBe(400);
      expect(
        (await request('POST', `/orders/${id}/cancel`, { status: 'CANCELLED' }))
          .status,
      ).toBe(400);
      expect((await cancel(id)).body.data.changed).toBe(true);
      expect((await cancel(id)).body.data.changed).toBe(false);
      const history = await request(
        'GET',
        `/orders/${id}/history?offset=1&limit=1`,
        undefined,
      );
      expect(history.body.data.total).toBe(2);
      expect(history.body.data.items[0]).toMatchObject({
        actorType: 'USER',
        actorUserId: actors.A.id,
        previousStatus: 'PENDING_PAYMENT',
        newStatus: 'CANCELLED',
      });
      for (const pid of ids) expect((await row(pid)).stock_available).toBe(10);
      expect((await orderState(id)).payments[0].status).toBe('EXPIRED');
    });
    test.each([
      'PAID',
      'EXPIRED',
      'PROCESSING',
      'SHIPPED',
      'COMPLETED',
      'overdue',
    ])('Day9 rejects %s with no effects', async (state) => {
      const { id } = await reserved();
      if (state === 'overdue')
        await source.query(
          "UPDATE orders SET created_at=clock_timestamp()-interval '2 hours',reservation_expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",
          [id],
        );
      else
        await source.query('UPDATE orders SET status=$2 WHERE id=$1', [
          id,
          state,
        ]);
      const before = await orderState(id);
      const result = await cancel(id);
      expect(result.status).toBe(409);
      expect(result.body.error.code).toBe('ORDER_NOT_ELIGIBLE');
      expect(await orderState(id)).toEqual(before);
    });
    test('Day9 concurrent cancellation queues on independent connections and releases once', async () => {
      const { id, ids } = await reserved();
      const runner = source.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      await runner.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [id]);
      const pending = [];
      try {
        pending.push(cancel(id));
        await waitOrders(1);
        pending.push(cancel(id));
        await waitOrders(2);
        await runner.commitTransaction();
        const results = await Promise.all(pending);
        expect(results.map((r) => r.status)).toEqual([200, 200]);
        expect(results.map((r) => r.body.data.changed).sort()).toEqual([
          false,
          true,
        ]);
        expect((await orderState(id)).history).toHaveLength(2);
        for (const pid of ids)
          expect((await row(pid)).stock_available).toBe(10);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await Promise.allSettled(pending);
      }
    });
    test.each(['status', 'deadline'])(
      'Day9 rechecks %s after order lock wait',
      async (kind) => {
        const { id } = await reserved();
        const runner = source.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        await runner.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [
          id,
        ]);
        const pending = cancel(id);
        try {
          await waitOrders(1);
          if (kind === 'status')
            await runner.query("UPDATE orders SET status='PAID' WHERE id=$1", [
              id,
            ]);
          else
            await runner.query(
              "UPDATE orders SET created_at=clock_timestamp()-interval '2 hours',reservation_expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",
              [id],
            );
          await runner.commitTransaction();
          expect((await pending).status).toBe(409);
          expect((await orderState(id)).history).toHaveLength(1);
        } finally {
          if (runner.isTransactionActive) await runner.rollbackTransaction();
          await runner.release();
          await Promise.allSettled([pending]);
        }
      },
    );
    test('Day9 holds order and attempts before sorted product release locks', async () => {
      const { id, ids } = await reserved();
      const blocker = await block(ids[1]);
      const pending = cancel(id);
      const probe = source.createQueryRunner();
      try {
        await waitProducts(1);
        await probe.connect();
        const payment = (
          await source.query('SELECT id FROM payments WHERE order_id=$1', [id])
        )[0].id;
        for (const [table, key] of [
          ['orders', id],
          ['payments', payment],
          ['products', ids[0]],
        ]) {
          await probe.startTransaction();
          await expect(
            probe.query(
              `SELECT id FROM ${table} WHERE id=$1 FOR UPDATE NOWAIT`,
              [key],
            ),
          ).rejects.toMatchObject({ driverError: { code: '55P03' } });
          await probe.rollbackTransaction();
        }
        await blocker.commitTransaction();
        expect((await pending).status).toBe(200);
      } finally {
        if (probe.isTransactionActive) await probe.rollbackTransaction();
        await probe.release();
        if (blocker.isTransactionActive) await blocker.rollbackTransaction();
        await blocker.release();
        await Promise.allSettled([pending]);
      }
    });

    test.each(['overflow', 'stock', 'history', 'payment'])(
      'Day9 %s fault rolls back order/payment/partial release/history',
      async (stage) => {
        const { id, ids } = await reserved();
        if (stage === 'overflow')
          await source.query(
            'UPDATE products SET stock_available=2147483647 WHERE id=$1',
            [ids[1]],
          );
        const before = await orderState(id);
        const stocks = await Promise.all(ids.map(row));
        const name = 'cancel_fault_' + randomBytes(8).toString('hex');
        const table =
          stage === 'stock'
            ? 'products'
            : stage === 'payment'
              ? 'payments'
              : 'order_status_history';
        const check =
          stage === 'stock'
            ? `id <> '${ids[1]}'::uuid OR stock_available=8`
            : stage === 'payment'
              ? `order_id <> '${id}'::uuid OR status='PENDING'`
              : `order_id <> '${id}'::uuid OR new_status <> 'CANCELLED'`;
        if (stage !== 'overflow')
          await source.query(
            `ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${check}) NOT VALID`,
          );
        try {
          const result = await cancel(id);
          expect(result.status).toBe(stage === 'overflow' ? 409 : 500);
          expect(result.body.error.code).toBe(
            stage === 'overflow' ? 'STOCK_RANGE_EXCEEDED' : 'INTERNAL_ERROR',
          );
          expect(JSON.stringify(result.body)).not.toContain(name);
          expect(await orderState(id)).toEqual(before);
          expect(await Promise.all(ids.map(row))).toEqual(stocks);
        } finally {
          if (stage !== 'overflow')
            await source.query(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
        }
      },
    );

    test.each(['release-first', 'adjustment-first'])(
      'M3 %s cancellation and audited adjustment preserve both stock changes',
      async (sequence) => {
        const { id, ids } = await reserved();
        const target = ids[0];
        const release = () => cancel(id);
        const adjust = () =>
          request(
            'POST',
            `/products/${target}/stock-adjustments`,
            { quantityDelta: 4, reason: 'M3 concurrent release' },
            'ADMIN',
          );
        const results = await twoQueued(
          target,
          sequence === 'release-first' ? release : adjust,
          sequence === 'release-first' ? adjust : release,
        );
        expect(results.map((r) => r.status)).toEqual(
          sequence === 'release-first' ? [200, 201] : [201, 200],
        );
        expect((await row(target)).stock_available).toBe(14);
        expect((await row(ids[1])).stock_available).toBe(10);
        const audits = await source.query(
          'SELECT * FROM inventory_adjustment_audit WHERE product_id=$1',
          [target],
        );
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
          previous_stock: sequence === 'release-first' ? 10 : 8,
          new_stock: sequence === 'release-first' ? 14 : 12,
          quantity_delta: 4,
        });
        const state = await orderState(id);
        expect(state.order.status).toBe('CANCELLED');
        expect(state.history).toHaveLength(2);
        expect(state.payments[0].status).toBe('EXPIRED');
        expect((await cancel(id)).body.data.changed).toBe(false);
        expect((await row(target)).stock_available).toBe(14);
      },
    );
    test('M3 adjustment consuming the last unit before queued checkout prevents oversell and partial order', async () => {
      const id = await product('10', 1);
      const before = await counts();
      const results = await twoQueued(
        id,
        () =>
          request(
            'POST',
            `/products/${id}/stock-adjustments`,
            { quantityDelta: -1, reason: 'M3 last-unit adjustment' },
            'ADMIN',
          ),
        () => checkout([item(id)]),
      );
      expect(results.map((r) => r.status)).toEqual([201, 409]);
      expect(results[1].body.error.code).toBe('INSUFFICIENT_STOCK');
      expect((await row(id)).stock_available).toBe(0);
      expect(await counts()).toEqual(before);
      const audits = await source.query(
        'SELECT * FROM inventory_adjustment_audit WHERE product_id=$1',
        [id],
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        previous_stock: 1,
        new_stock: 0,
        quantity_delta: -1,
      });
    });
    test.each(['release-first', 'checkout-first'])(
      'M3 %s release versus last-unit checkout leaves no lost stock or partial records',
      async (sequence) => {
        const pid = await product('10', 1);
        const original = await checkout([item(pid)]);
        expect(original.status).toBe(201);
        const id = original.body.data.id;
        const before = await counts('B');
        const release = () => cancel(id);
        const buy = () => checkout([item(pid)], 'B');
        const results = await twoQueued(
          pid,
          sequence === 'release-first' ? release : buy,
          sequence === 'release-first' ? buy : release,
        );
        const won = sequence === 'release-first';
        expect(results.map((r) => r.status)).toEqual(
          won ? [200, 201] : [409, 200],
        );
        expect((await row(pid)).stock_available).toBe(won ? 0 : 1);
        const after = await counts('B');
        expect(after).toEqual({
          orders: before.orders + (won ? 1 : 0),
          items: before.items + (won ? 1 : 0),
          history: before.history + (won ? 1 : 0),
          payments: before.payments,
        });
        const state = await orderState(id);
        expect(state.order.status).toBe('CANCELLED');
        expect(state.history).toHaveLength(2);
        expect((await cancel(id)).body.data.changed).toBe(false);
        expect((await row(pid)).stock_available).toBe(won ? 0 : 1);
      },
    );

    test('Swagger documents own orders and checkout without future payment initiation', async () => {
      const spec = await (await fetch(app.base + '/api/docs-json')).json();
      expect(spec.paths['/api/v1/orders'].post.security).toEqual([
        { bearer: [] },
      ]);
      expect(spec.paths['/api/v1/orders'].get).toBeDefined();
      expect(
        spec.paths['/api/v1/orders/{id}/payment-attempts'],
      ).toBeUndefined();
      expect(
        spec.components.schemas.CheckoutDto.properties.items,
      ).toMatchObject({ minItems: 1, maxItems: 100 });
      expect(
        spec.paths['/api/v1/orders'].post.responses['201'].content[
          'application/json'
        ].schema.properties.data.properties.totalVnd.type,
      ).toBe('string');
    });
  });
}
module.exports = { registerCheckoutCases };
