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

function registerFulfillmentCases(getSource, appDatabase) {
  describe('Day10 STAFF fulfillment API on PostgreSQL', () => {
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
          email: `${randomUUID()}@fulfillment.invalid`,
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

    const item = (productId, quantity = 1) => ({ productId, quantity });
    const advance = (id, status, actor = 'STAFF', extra = {}) =>
      request(
        'POST',
        `/staff/orders/${id}/status`,
        { status, ...extra },
        actor,
      );
    async function fixture(status = 'PAID', owner = 'A') {
      const pid = await product('10', 10);
      const result = await request(
        'POST',
        '/orders',
        { items: [item(pid, 2)], shipping },
        owner,
      );
      expect(result.status).toBe(201);
      const id = result.body.data.id;
      if (status !== 'PENDING_PAYMENT') {
        await source.transaction(async (manager) => {
          await manager.query('UPDATE orders SET status=$2 WHERE id=$1', [
            id,
            status,
          ]);
          if (['PAID', 'PROCESSING', 'SHIPPED', 'COMPLETED'].includes(status)) {
            await manager.query(
              "INSERT INTO payments(id,order_id,provider_reference,status,amount_vnd,payment_url,expires_at,terminal_at,provider_transaction_reference,response_code,transaction_status_code) VALUES ($1,$2,$3,'SUCCESS',20,$4,clock_timestamp()+interval '20 minutes',clock_timestamp(),'private-transaction','00','00')",
              [
                randomUUID(),
                id,
                randomUUID(),
                'https://fixture.invalid/private-signed-url',
              ],
            );
            const edges = ['PAID', 'PROCESSING', 'SHIPPED', 'COMPLETED'];
            let previous = 'PENDING_PAYMENT';
            for (const next of edges.slice(0, edges.indexOf(status) + 1)) {
              await manager.query(
                'INSERT INTO order_status_history(id,order_id,previous_status,new_status,actor_user_id) VALUES ($1,$2,$3,$4,$5)',
                [
                  randomUUID(),
                  id,
                  previous,
                  next,
                  next === 'PAID' ? null : actors.STAFF.id,
                ],
              );
              previous = next;
            }
          }
        });
      }
      return { id, pid };
    }
    async function snapshot(id) {
      return {
        order: (
          await source.query('SELECT * FROM orders WHERE id=$1', [id])
        )[0],
        items: await source.query(
          'SELECT * FROM order_items WHERE order_id=$1 ORDER BY product_id',
          [id],
        ),
        payments: await source.query(
          'SELECT * FROM payments WHERE order_id=$1 ORDER BY id',
          [id],
        ),
        history: await source.query(
          'SELECT * FROM order_status_history WHERE order_id=$1 ORDER BY created_at,id',
          [id],
        ),
      };
    }
    async function barrier(id) {
      const runner = source.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      await runner.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [id]);
      return runner;
    }
    async function waitOrders(n) {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        const rows = await source.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%orders%' AND query LIKE '%FOR UPDATE%'",
        );
        if (rows[0].n >= n) return;
        await delay(15);
      }
      throw new Error('Expected independent fulfillment order-lock waiters');
    }
    async function queued(id, first, second) {
      const blocker = await barrier(id);
      const pending = [];
      try {
        pending.push(first());
        await waitOrders(1);
        pending.push(second());
        await waitOrders(2);
        await blocker.commitTransaction();
        return await Promise.all(pending);
      } finally {
        if (blocker.isTransactionActive) await blocker.rollbackTransaction();
        await blocker.release();
        await Promise.allSettled(pending);
      }
    }
    test.each([null, 'A', 'B'])(
      '%s cannot access STAFF queue/detail/history or mutate status',
      async (actor) => {
        const { id, pid } = await fixture();
        const before = await snapshot(id);
        const stock = await row(pid);
        for (const path of [
          '/staff/orders',
          `/staff/orders/${id}`,
          `/staff/orders/${id}/history`,
        ])
          expect((await request('GET', path, undefined, actor)).status).toBe(
            actor ? 403 : 401,
          );
        expect((await advance(id, 'PROCESSING', actor)).status).toBe(
          actor ? 403 : 401,
        );
        expect(await snapshot(id)).toEqual(before);
        expect(await row(pid)).toEqual(stock);
      },
    );
    test.each(['STAFF', 'ADMIN'])(
      '%s sees shared eligible queue with stable pagination and safe summaries',
      async (actor) => {
        const a = await fixture('PAID', 'A');
        const b = await fixture('PAID', 'B');
        const time = '2020-01-01T00:00:00Z';
        await source.query(
          'UPDATE orders SET created_at=$2 WHERE id=ANY($1::uuid[])',
          [[a.id, b.id], time],
        );
        const expected = await source.query(
          "SELECT id FROM orders WHERE status='PAID' ORDER BY created_at,id",
        );
        const list = await request(
          'GET',
          '/staff/orders?limit=1',
          undefined,
          actor,
        );
        expect(list.status).toBe(200);
        expect(list.cache).toBe('no-store');
        expect(list.body.data).toMatchObject({
          offset: 0,
          limit: 1,
          total: expected.length,
        });
        expect(list.body.data.items.map((o) => o.id)).toEqual([expected[0].id]);
        const second = await request(
          'GET',
          '/staff/orders?offset=1&limit=1',
          undefined,
          actor,
        );
        expect(second.body.data.items[0].id).toBe(expected[1].id);
        expect(second.body.data.total).toBe(expected.length);
        const detail = await request(
          'GET',
          `/staff/orders/${b.id}`,
          undefined,
          actor,
        );
        expect(detail.body.data).toMatchObject({
          customerId: actors.B.id,
          shipping,
          items: [
            {
              productId: b.pid,
              quantity: 2,
              unitPriceVnd: '10',
              lineTotalVnd: '20',
            },
          ],
        });
        expect(detail.body.data.paymentSummary.successfulAttempt.status).toBe(
          'SUCCESS',
        );
        expect(detail.body.data.paymentSummary.latestAttempt.status).toBe(
          'SUCCESS',
        );
        expect(JSON.stringify([list.body, detail.body])).not.toMatch(
          /private-signed-url|private-transaction|paymentUrl|providerTransactionReference|responseCode|transactionStatusCode|password|refreshToken/,
        );
        expect(list.body.data.items[0]).not.toHaveProperty('shipping');
        expect(list.body.data.items[0]).not.toHaveProperty('customerId');
        const history = await request(
          'GET',
          `/staff/orders/${b.id}/history?offset=1&limit=1`,
          undefined,
          actor,
        );
        expect(history.body.data.total).toBe(2);
        expect(history.body.data.items[0]).toMatchObject({
          newStatus: 'PAID',
          actorType: 'SYSTEM',
          actorUserId: null,
        });
      },
    );
    test.each(['PAID', 'PROCESSING', 'SHIPPED', 'COMPLETED'])(
      '%s is readable by STAFF/ADMIN with exact status-filter totals',
      async (status) => {
        const { id } = await fixture(status);
        for (const actor of ['STAFF', 'ADMIN']) {
          expect(
            (await request('GET', `/staff/orders/${id}`, undefined, actor))
              .status,
          ).toBe(200);
          expect(
            (
              await request(
                'GET',
                `/staff/orders/${id}/history`,
                undefined,
                actor,
              )
            ).status,
          ).toBe(200);
          const list = await request(
            'GET',
            `/staff/orders?status=${status}&limit=100`,
            undefined,
            actor,
          );
          expect(list.body.data.total).toBe(
            (
              await source.query(
                'SELECT count(*)::int AS n FROM orders WHERE status=$1',
                [status],
              )
            )[0].n,
          );
          expect(list.body.data.items.every((o) => o.status === status)).toBe(
            true,
          );
          expect(list.body.data.items.some((o) => o.id === id)).toBe(true);
        }
      },
    );
    test.each(['PENDING_PAYMENT', 'CANCELLED', 'EXPIRED', 'missing'])(
      '%s is outside fulfillment scope for reads and mutation',
      async (status) => {
        const id =
          status === 'missing' ? randomUUID() : (await fixture(status)).id;
        for (const actor of ['STAFF', 'ADMIN']) {
          for (const path of [
            `/staff/orders/${id}`,
            `/staff/orders/${id}/history`,
          ])
            expect(
              (await request('GET', path, undefined, actor)).body.error.code,
            ).toBe('NOT_FOUND');
          expect((await advance(id, 'PROCESSING', actor)).status).toBe(404);
        }
      },
    );
    test('queue/history/transition DTOs reject unknown filters, protected fields and unsafe notes', async () => {
      const { id } = await fixture();
      const before = await snapshot(id);
      for (const query of [
        'status=PENDING_PAYMENT',
        'status=CANCELLED',
        'status=EXPIRED',
        'status=PAID&status=SHIPPED',
        'status=paid',
        'status=PAID%27',
        'sort=createdAt',
        'customerId=' + actors.A.id,
        'offset=-1',
        'limit=101',
        'offset=1.5',
        'limit=NaN',
      ])
        expect(
          (await request('GET', '/staff/orders?' + query, undefined, 'STAFF'))
            .status,
        ).toBe(400);
      expect(
        (
          await request(
            'GET',
            `/staff/orders/${id}/history?status=PAID`,
            undefined,
            'STAFF',
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await request(
            'GET',
            `/staff/orders/${id}?include=payments`,
            undefined,
            'STAFF',
          )
        ).status,
      ).toBe(400);
      for (const body of [
        {},
        { status: 'PAID' },
        { status: 'PENDING_PAYMENT' },
        { status: 'CANCELLED' },
        { status: 'EXPIRED' },
        { status: null },
        { status: ['PROCESSING'] },
        ...['', ' ', 'a'.repeat(1001), 'bad\u0000note', 1, {}].map((note) => ({
          status: 'PROCESSING',
          note,
        })),
        ...Object.entries({
          actorUserId: actors.ADMIN.id,
          customerId: actors.A.id,
          paymentStatus: 'SUCCESS',
          stockAvailable: 1,
          totalVnd: '1',
        }).map(([key, value]) => ({ status: 'PROCESSING', [key]: value })),
      ])
        expect(
          (await request('POST', `/staff/orders/${id}/status`, body, 'STAFF'))
            .status,
        ).toBe(400);
      expect(
        (
          await request(
            'POST',
            `/staff/orders/${id}/status?actorId=${actors.ADMIN.id}`,
            { status: 'PROCESSING' },
            'STAFF',
          )
        ).status,
      ).toBe(400);
      expect(
        (await request('GET', '/staff/orders/invalid', undefined, 'STAFF'))
          .status,
      ).toBe(400);
      expect(await snapshot(id)).toEqual(before);
    });
    const transitions = ['PAID', 'PROCESSING', 'SHIPPED', 'COMPLETED'].flatMap(
      (current) =>
        ['PROCESSING', 'SHIPPED', 'COMPLETED'].map((next) => [current, next]),
    );
    test.each(transitions)(
      'edge %s -> %s obeys only next edge and preserves payments/stock/snapshots',
      async (current, next) => {
        const { id, pid } = await fixture(current);
        const before = await snapshot(id);
        const stock = await row(pid);
        const allowed =
          { PAID: 'PROCESSING', PROCESSING: 'SHIPPED', SHIPPED: 'COMPLETED' }[
            current
          ] === next;
        const result = await advance(id, next, 'ADMIN', {
          note: '  packed safely  ',
        });
        expect(result.status).toBe(allowed ? 200 : 409);
        const after = await snapshot(id);
        if (allowed) {
          expect(result.body.data.status).toBe(next);
          expect(after.order.status).toBe(next);
          expect(after.history).toHaveLength(before.history.length + 1);
          expect(after.history.at(-1)).toMatchObject({
            previous_status: current,
            new_status: next,
            actor_user_id: actors.ADMIN.id,
            note: 'packed safely',
          });
          expect(after.items).toEqual(before.items);
          expect(after.payments).toEqual(before.payments);
          expect({
            ...after.order,
            status: before.order.status,
            updated_at: before.order.updated_at,
          }).toEqual(before.order);
        } else {
          expect(result.body.error.code).toBe('INVALID_STATE_TRANSITION');
          expect(after).toEqual(before);
        }
        expect(await row(pid)).toEqual(stock);
      },
    );
    test('STAFF/ADMIN share sequential fulfillment, note null/default, USER history and repeat conflicts', async () => {
      const { id } = await fixture();
      // A paid order remains fulfillable after its old unpaid reservation deadline.
      await source.query(
        "UPDATE orders SET created_at=clock_timestamp()-interval '2 hours',reservation_expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",
        [id],
      );
      for (const [next, actor, note] of [
        ['PROCESSING', 'STAFF', null],
        ['SHIPPED', 'ADMIN', undefined],
        ['COMPLETED', 'STAFF', 'x'.repeat(1000)],
      ]) {
        expect(
          (await advance(id, next, actor, note === undefined ? {} : { note }))
            .status,
        ).toBe(200);
        expect((await advance(id, next, actor)).status).toBe(409);
      }
      const history = (
        await request(
          'GET',
          `/staff/orders/${id}/history?offset=2`,
          undefined,
          'STAFF',
        )
      ).body.data;
      expect(history.total).toBe(5);
      expect(
        history.items.map((h) => [h.actorType, h.actorUserId, h.note]),
      ).toEqual([
        ['USER', actors.STAFF.id, null],
        ['USER', actors.ADMIN.id, null],
        ['USER', actors.STAFF.id, 'x'.repeat(1000)],
      ]);
      expect(
        (await request('GET', `/orders/${id}/history`, undefined, 'A')).body
          .data.total,
      ).toBe(5);
    });
    test('concurrent same-edge transitions have one winner with one human history', async () => {
      const { id, pid } = await fixture();
      const before = await snapshot(id);
      const stock = await row(pid);
      const results = await queued(
        id,
        () => advance(id, 'PROCESSING', 'STAFF'),
        () => advance(id, 'PROCESSING', 'ADMIN'),
      );
      expect(results.map((r) => r.status)).toEqual([200, 409]);
      const after = await snapshot(id);
      expect(after.history).toHaveLength(3);
      expect(after.history.at(-1).actor_user_id).toBe(actors.STAFF.id);
      expect(after.order.status).toBe('PROCESSING');
      expect(after.payments).toEqual(before.payments);
      expect(await row(pid)).toEqual(stock);
    });
    test('queued successive edges recheck committed status and attribute each winner', async () => {
      const { id } = await fixture();
      const results = await queued(
        id,
        () => advance(id, 'PROCESSING', 'STAFF'),
        () => advance(id, 'SHIPPED', 'ADMIN'),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const state = await snapshot(id);
      expect(state.order.status).toBe('SHIPPED');
      expect(
        state.history
          .slice(2)
          .map((h) => [h.previous_status, h.new_status, h.actor_user_id]),
      ).toEqual([
        ['PAID', 'PROCESSING', actors.STAFF.id],
        ['PROCESSING', 'SHIPPED', actors.ADMIN.id],
      ]);
    });
    test.each(['PROCESSING', 'EXPIRED'])(
      'post-lock %s state is rechecked before changing status',
      async (status) => {
        const { id } = await fixture();
        const blocker = await barrier(id);
        const pending = advance(id, 'PROCESSING');
        try {
          await waitOrders(1);
          await blocker.query('UPDATE orders SET status=$2 WHERE id=$1', [
            id,
            status,
          ]);
          await blocker.commitTransaction();
          expect((await pending).status).toBe(status === 'EXPIRED' ? 404 : 409);
          expect((await snapshot(id)).history).toHaveLength(2);
        } finally {
          if (blocker.isTransactionActive) await blocker.rollbackTransaction();
          await blocker.release();
          await Promise.allSettled([pending]);
        }
      },
    );
    test('fulfillment locks order then payments by ID and uses a post-wait database clock', async () => {
      const { id, pid } = await fixture();
      await source.query(
        "INSERT INTO payments(id,order_id,provider_reference,status,amount_vnd,payment_url,expires_at,terminal_at) VALUES ($1,$2,$3,'FAILED',20,$4,clock_timestamp()+interval '20 minutes',clock_timestamp())",
        [randomUUID(), id, randomUUID(), 'https://fixture.invalid/failed-url'],
      );
      const payments = await source.query(
        'SELECT id FROM payments WHERE order_id=$1 ORDER BY id',
        [id],
      );
      const before = await snapshot(id);
      const stock = await row(pid);
      const blocker = source.createQueryRunner();
      const probe = source.createQueryRunner();
      await blocker.connect();
      await blocker.startTransaction();
      await blocker.query('SELECT id FROM payments WHERE id=$1 FOR UPDATE', [
        payments[1].id,
      ]);
      const pending = advance(id, 'PROCESSING');
      try {
        const deadline = Date.now() + 12000;
        let waiting = false;
        while (Date.now() < deadline) {
          const rows = await source.query(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%payments%' AND query LIKE '%FOR UPDATE%'",
          );
          if (rows[0].n >= 1) {
            waiting = true;
            break;
          }
          await delay(15);
        }
        expect(waiting).toBe(true);
        await probe.connect();
        for (const [table, key] of [
          ['orders', id],
          ['payments', payments[0].id],
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
        const marker = (
          await blocker.query('SELECT clock_timestamp() AS time')
        )[0].time;
        await blocker.commitTransaction();
        const result = await pending;
        expect(result.status).toBe(200);
        expect(
          new Date(result.body.data.updatedAt).getTime(),
        ).toBeGreaterThanOrEqual(marker.getTime());
        const after = await snapshot(id);
        expect(after.payments).toEqual(before.payments);
        expect(after.history).toHaveLength(3);
        expect(await row(pid)).toEqual(stock);
      } finally {
        if (probe.isTransactionActive) await probe.rollbackTransaction();
        await probe.release();
        if (blocker.isTransactionActive) await blocker.rollbackTransaction();
        await blocker.release();
        await Promise.allSettled([pending]);
      }
    });

    test.each(['order', 'history'])(
      '%s persistence failure rolls back order/history and preserves payment/stock',
      async (stage) => {
        const { id, pid } = await fixture();
        const before = await snapshot(id);
        const stock = await row(pid);
        const name = 'fulfillment_fault_' + randomBytes(8).toString('hex');
        const table = stage === 'order' ? 'orders' : 'order_status_history';
        const check =
          stage === 'order'
            ? `id <> '${id}'::uuid OR status='PAID'`
            : `order_id <> '${id}'::uuid OR new_status <> 'PROCESSING'`;
        await source.query(
          `ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${check}) NOT VALID`,
        );
        try {
          const result = await advance(id, 'PROCESSING');
          expect(result.status).toBe(500);
          expect(result.body.error.code).toBe('INTERNAL_ERROR');
          expect(JSON.stringify(result.body)).not.toContain(name);
          expect(await snapshot(id)).toEqual(before);
          expect(await row(pid)).toEqual(stock);
        } finally {
          await source.query(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
        }
        expect((await advance(id, 'PROCESSING')).status).toBe(200);
      },
    );
    test('Swagger advertises shared Staff guards, minimal filters and public callback boundary', async () => {
      const spec = await (await fetch(app.base + '/api/docs-json')).json();
      for (const path of [
        '/api/v1/staff/orders',
        '/api/v1/staff/orders/{id}',
        '/api/v1/staff/orders/{id}/history',
        '/api/v1/staff/orders/{id}/status',
      ]) {
        const op = spec.paths[path][path.endsWith('/status') ? 'post' : 'get'];
        expect(op.security).toEqual([{ bearer: [] }]);
        expect(op.responses['200']).toBeDefined();
      }
      expect(
        spec.paths['/api/v1/staff/orders'].get.parameters.find(
          (p) => p.name === 'status',
        ).schema.enum,
      ).toEqual(['PAID', 'PROCESSING', 'SHIPPED', 'COMPLETED']);
      expect(
        spec.components.schemas.AdvanceOrderDto.properties.status.enum,
      ).toEqual(['PROCESSING', 'SHIPPED', 'COMPLETED']);
      expect(spec.paths['/api/v1/payments/vnpay/ipn'].get).toBeDefined();
    });
  });
}
module.exports = { registerFulfillmentCases };
