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

function registerPaymentCases(getSource, appDatabase) {
  describe('Day11 VNPay initiation API on PostgreSQL', () => {
    let source;
    let app;
    const actors = {};
    const hashSecret = randomBytes(32).toString('hex');
    const shipping = {
      recipientName: 'Checkout recipient',
      recipientPhone: '+84901234567',
      addressLine: 'Delivery address',
      provinceCity: 'Delivery city',
    };
    beforeAll(async () => {
      source = getSource();
      app = await startBuiltApplication(appDatabase(), {
        vnpay: { hashSecret },
      });
      for (const [name, role] of [
        ['A', 'CUSTOMER'],
        ['B', 'CUSTOMER'],
        ['STAFF', 'STAFF'],
        ['ADMIN', 'ADMIN'],
      ]) {
        const credentials = {
          email: `${randomUUID()}@payments.invalid`,
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

    async function reserved(price = '10') {
      const pid = await product(price, 10);
      const response = await request('POST', '/orders', {
        items: [{ productId: pid, quantity: 2 }],
        shipping,
      });
      expect(response.status).toBe(201);
      return { id: response.body.data.id, pid };
    }
    const initiate = (id, actor = 'A', body = {}) =>
      request('POST', `/orders/${id}/payment-attempts`, body, actor);
    async function snapshot(id) {
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
        attempts: await source.query(
          'SELECT * FROM payments WHERE order_id=$1 ORDER BY id',
          [id],
        ),
      };
    }
    async function attempt(id, status) {
      const paymentId = randomUUID();
      await source.query(
        "INSERT INTO payments(id,order_id,provider_reference,status,amount_vnd,payment_url,expires_at,terminal_at,response_code) VALUES ($1,$2,$3,$4::varchar,20,$5,clock_timestamp()+interval '20 minutes',CASE WHEN $4::varchar='PENDING' THEN NULL ELSE clock_timestamp() END,CASE WHEN $4::varchar='FAILED' THEN '24' ELSE NULL END)",
        [
          paymentId,
          id,
          randomUUID().replaceAll('-', ''),
          status,
          'https://fixture.invalid/previous-attempt',
        ],
      );
      return paymentId;
    }
    async function barrier(table, id) {
      const runner = source.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      await runner.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [
        id,
      ]);
      return runner;
    }
    async function waitLocks(table, n) {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        const rows = await source.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1 AND query LIKE '%FOR UPDATE%'",
          ['%' + table + '%'],
        );
        if (rows[0].n >= n) return;
        await delay(15);
      }
      throw new Error('Expected initiation lock waiters');
    }
    test.each([null, 'STAFF', 'ADMIN', 'B'])(
      '%s cannot initiate a foreign/disallowed payment',
      async (actor) => {
        const { id, pid } = await reserved();
        const before = await snapshot(id);
        const stock = await row(pid);
        const result = await initiate(id, actor);
        expect(result.status).toBe(
          actor === null ? 401 : actor === 'B' ? 404 : 403,
        );
        expect(await snapshot(id)).toEqual(before);
        expect(await row(pid)).toEqual(stock);
      },
    );
    test('missing/foreign use identical404 and request rejects amount/owner/query transport', async () => {
      const { id } = await reserved();
      expect((await initiate(randomUUID())).body.error.code).toBe('NOT_FOUND');
      for (const body of [
        { amountVnd: '1' },
        { amount: '1' },
        { userId: actors.B.id },
        { status: 'SUCCESS' },
        { paymentUrl: 'https://client.invalid' },
        [],
        null,
      ])
        expect((await initiate(id, 'A', body)).status).toBe(400);
      expect(
        (
          await request(
            'POST',
            `/orders/${id}/payment-attempts?amountVnd=1`,
            {},
            'A',
          )
        ).status,
      ).toBe(400);
      expect((await initiate('invalid')).status).toBe(400);
      expect((await snapshot(id)).attempts).toHaveLength(0);
    });
    test('persists one exact-total pending attempt and returns signed URL only to owner initiation, without stock/history changes', async () => {
      const { id, pid } = await reserved('12345');
      const before = await snapshot(id);
      const stock = await row(pid);
      const result = await initiate(id, 'A', undefined);
      expect(result.status).toBe(201);
      expect(result.cache).toBe('no-store');
      const data = result.body.data;
      expect(data.reused).toBe(false);
      expect(data.attempt).toMatchObject({
        provider: 'VNPAY',
        status: 'PENDING',
        currency: 'VND',
        amountVnd: '24690',
        terminalAt: null,
      });
      expect(data.attempt).not.toHaveProperty('paymentUrl');
      expect(data.attempt.providerReference).toMatch(/^[a-f0-9]{32}$/);
      const url = new URL(data.paymentUrl);
      expect(url.origin + url.pathname).toBe(
        'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
      );
      expect(url.searchParams.get('vnp_Amount')).toBe('2469000');
      expect(url.searchParams.get('vnp_TxnRef')).toBe(
        data.attempt.providerReference,
      );
      expect(url.searchParams.get('vnp_TmnCode')).toBe('FIXT0001');
      expect(url.searchParams.get('vnp_IpnUrl')).toBeNull();
      expect(url.searchParams.get('vnp_CreateDate')).toMatch(/^\d{14}$/);
      expect(url.searchParams.get('vnp_IpAddr')).toBe('127.0.0.1');
      expect(
        new Date(data.attempt.expiresAt) - new Date(data.attempt.createdAt),
      ).toBe(1200000);
      const after = await snapshot(id);
      expect(after.order).toEqual(before.order);
      expect(after.items).toEqual(before.items);
      expect(after.history).toEqual(before.history);
      expect(await row(pid)).toEqual(stock);
      expect(after.attempts).toHaveLength(1);
      expect(after.attempts[0]).toMatchObject({
        id: data.attempt.id,
        provider_reference: data.attempt.providerReference,
        amount_vnd: '24690',
        status: 'PENDING',
        payment_url: data.paymentUrl,
      });
      for (const path of [`/orders/${id}`, '/orders?limit=100']) {
        const read = await request('GET', path, undefined);
        expect(read.status).toBe(200);
        expect(JSON.stringify(read.body)).not.toMatch(
          /paymentUrl|vnp_SecureHash/,
        );
      }
      expect(app.output()).not.toContain(data.paymentUrl);
      expect(app.output()).not.toContain(
        url.searchParams.get('vnp_SecureHash'),
      );
      expect(app.output()).not.toContain(hashSecret);
      await expect(
        source.query(
          "INSERT INTO payments(id,order_id,provider_reference,amount_vnd,payment_url,expires_at) VALUES ($1,$2,$3,1,'https://fixture.invalid/duplicate',clock_timestamp()+interval '20 minutes')",
          [randomUUID(), id, randomUUID()],
        ),
      ).rejects.toMatchObject({ driverError: { code: '23505' } });
      expect((await snapshot(id)).attempts).toHaveLength(1);
    });
    test.each([
      'PAID',
      'PROCESSING',
      'SHIPPED',
      'COMPLETED',
      'CANCELLED',
      'EXPIRED',
      'overdue',
    ])('%s order is not eligible', async (status) => {
      const { id } = await reserved();
      if (status === 'overdue')
        await source.query(
          "UPDATE orders SET created_at=clock_timestamp()-interval '2 hours',reservation_expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",
          [id],
        );
      else
        await source.query('UPDATE orders SET status=$2 WHERE id=$1', [
          id,
          status,
        ]);
      const before = await snapshot(id);
      const result = await initiate(id);
      expect(result.status).toBe(409);
      expect(result.body.error.code).toBe('ORDER_NOT_ELIGIBLE');
      expect(await snapshot(id)).toEqual(before);
    });
    test.each(['fresh', 'past-target'])(
      'PENDING %s remains unresolved on repeats, never reused/replaced/expired by initiation',
      async (kind) => {
        const { id } = await reserved();
        const pid = await attempt(id, 'PENDING');
        if (kind === 'past-target')
          await source.query(
            "UPDATE payments SET created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",
            [pid],
          );
        const before = await snapshot(id);
        for (let n = 0; n < 2; n++) {
          const result = await initiate(id);
          expect(result.status).toBe(409);
          expect(result.body.error.code).toBe('PAYMENT_UNRESOLVED');
        }
        expect(await snapshot(id)).toEqual(before);
      },
    );
    test.each(['FAILED', 'EXPIRED'])(
      'genuinely terminal %s fixture allows exactly one replacement; prior row remains immutable',
      async (status) => {
        const { id } = await reserved();
        await attempt(id, status);
        const before = await snapshot(id);
        const result = await initiate(id);
        expect(result.status).toBe(201);
        expect(result.body.data.attempt.providerReference).not.toBe(
          before.attempts[0].provider_reference,
        );
        const after = await snapshot(id);
        expect(after.attempts).toHaveLength(2);
        expect(
          after.attempts.find((p) => p.id === before.attempts[0].id),
        ).toEqual(before.attempts[0]);
        expect(
          after.attempts.filter((p) => p.status === 'PENDING'),
        ).toHaveLength(1);
        expect((await initiate(id)).body.error.code).toBe('PAYMENT_UNRESOLVED');
      },
    );
    test('SUCCESS attempt blocks a new attempt even with inconsistent pending order fixture', async () => {
      const { id } = await reserved();
      await attempt(id, 'SUCCESS');
      const before = await snapshot(id);
      expect((await initiate(id)).body.error.code).toBe('PAYMENT_UNRESOLVED');
      expect(await snapshot(id)).toEqual(before);
    });
    test('unconfigured payment fails503 with no attempt and no secret fallback', async () => {
      const other = await startBuiltApplication(appDatabase());
      try {
        const login = await request(
          'POST',
          '/auth/login',
          actors.A.credentials,
          null,
          other.base,
        );
        const { id } = await reserved();
        const before = await snapshot(id);
        const result = await request(
          'POST',
          `/orders/${id}/payment-attempts`,
          {},
          'A',
          other.base,
          login.body.data.accessToken,
        );
        expect(result.status).toBe(503);
        expect(result.body.error.code).toBe('PAYMENT_UNAVAILABLE');
        expect(await snapshot(id)).toEqual(before);
      } finally {
        await other.close();
      }
    });
    test('provider amount overflow rejects and leaves reservation unchanged', async () => {
      const { id, pid } = await reserved('5000000000');
      const before = await snapshot(id);
      const stock = await row(pid);
      expect((await initiate(id)).body.error.code).toBe('MONEY_LIMIT_EXCEEDED');
      expect(await snapshot(id)).toEqual(before);
      expect(await row(pid)).toEqual(stock);
    });
    test('real DB signing failure rejects safely with no partial attempt', async () => {
      const { ConfigService } = require('@nestjs/config');
      const {
        PaymentsService,
      } = require('../dist/modules/payments/payments.service');
      const { id } = await reserved();
      const before = await snapshot(id);
      const service = new PaymentsService(
        source,
        new ConfigService({
          vnpay: { mode: 'sandbox' },
          expiry: { paymentAttemptSeconds: 1200 },
        }),
        {
          create: () => {
            throw new Error('private signer failure ' + hashSecret);
          },
        },
      );
      await expect(
        service.initiate(actors.A.id, id, '127.0.0.1'),
      ).rejects.toMatchObject({ code: 'PAYMENT_UNAVAILABLE' });
      expect(await snapshot(id)).toEqual(before);
    });
    test('DB insert failure after URL signing rolls back and exposes/logs no signed URL or secret', async () => {
      const { id } = await reserved();
      const before = await snapshot(id);
      const name = 'payment_fault_' + randomBytes(8).toString('hex');
      await source.query(
        `ALTER TABLE payments ADD CONSTRAINT ${name} CHECK (order_id <> '${id}'::uuid) NOT VALID`,
      );
      try {
        const result = await initiate(id);
        expect(result.status).toBe(500);
        expect(result.body.error.code).toBe('INTERNAL_ERROR');
        expect(JSON.stringify(result.body)).not.toMatch(
          /vnp_SecureHash|paymentUrl/,
        );
        expect(JSON.stringify(result.body)).not.toContain(name);
        expect(await snapshot(id)).toEqual(before);
        expect(app.output()).not.toMatch(
          /vnp_SecureHash|private signer failure/,
        );
        expect(app.output()).not.toContain(hashSecret);
      } finally {
        await source.query(`ALTER TABLE payments DROP CONSTRAINT ${name}`);
      }
      expect((await initiate(id)).status).toBe(201);
    });
    test('concurrent initiation queues on independent order locks: one201 and one unresolved409', async () => {
      const { id, pid } = await reserved();
      const before = await snapshot(id);
      const stock = await row(pid);
      const blocker = await barrier('orders', id);
      const pending = [];
      try {
        pending.push(initiate(id));
        await waitLocks('orders', 1);
        pending.push(initiate(id));
        await waitLocks('orders', 2);
        await blocker.commitTransaction();
        const results = await Promise.all(pending);
        expect(results.map((r) => r.status)).toEqual([201, 409]);
        expect(results[1].body.error.code).toBe('PAYMENT_UNRESOLVED');
        const after = await snapshot(id);
        expect(after.attempts).toHaveLength(1);
        expect(after.order).toEqual(before.order);
        expect(after.history).toEqual(before.history);
        expect(await row(pid)).toEqual(stock);
      } finally {
        if (blocker.isTransactionActive) await blocker.rollbackTransaction();
        await blocker.release();
        await Promise.allSettled(pending);
      }
    });
    test.each(['PAID', 'overdue'])(
      'rechecks %s after order-lock wait',
      async (state) => {
        const { id } = await reserved();
        const blocker = await barrier('orders', id);
        const pending = initiate(id);
        try {
          await waitLocks('orders', 1);
          if (state === 'PAID')
            await blocker.query("UPDATE orders SET status='PAID' WHERE id=$1", [
              id,
            ]);
          else
            await blocker.query(
              "UPDATE orders SET created_at=clock_timestamp()-interval '2 hours',reservation_expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",
              [id],
            );
          await blocker.commitTransaction();
          expect((await pending).body.error.code).toBe('ORDER_NOT_ELIGIBLE');
          expect((await snapshot(id)).attempts).toHaveLength(0);
        } finally {
          if (blocker.isTransactionActive) await blocker.rollbackTransaction();
          await blocker.release();
          await Promise.allSettled([pending]);
        }
      },
    );
    test('order then sorted attempt locks, current attempt state and wall clock are rechecked after lock wait', async () => {
      const { id } = await reserved();
      await attempt(id, 'FAILED');
      await attempt(id, 'EXPIRED');
      const previous = (await snapshot(id)).attempts;
      const blocker = await barrier('payments', previous[1].id);
      const probe = source.createQueryRunner();
      const pending = initiate(id);
      try {
        await waitLocks('payments', 1);
        await probe.connect();
        for (const [table, key] of [
          ['orders', id],
          ['payments', previous[0].id],
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
        expect(result.status).toBe(201);
        expect(
          new Date(result.body.data.attempt.createdAt).getTime(),
        ).toBeGreaterThanOrEqual(marker.getTime());
        expect((await snapshot(id)).attempts).toHaveLength(3);
      } finally {
        if (probe.isTransactionActive) await probe.rollbackTransaction();
        await probe.release();
        if (blocker.isTransactionActive) await blocker.rollbackTransaction();
        await blocker.release();
        await Promise.allSettled([pending]);
      }
    });
    test('attempt target is configurable independently of order reservation and spoofed forwarded IP is ignored', async () => {
      const other = await startBuiltApplication(appDatabase(), {
        vnpay: { hashSecret },
        paymentAttemptSeconds: 73,
      });
      try {
        const login = await request(
          'POST',
          '/auth/login',
          actors.A.credentials,
          null,
          other.base,
        );
        const { id } = await reserved();
        const response = await fetch(
          other.base + `/api/v1/orders/${id}/payment-attempts`,
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + login.body.data.accessToken,
              'X-Forwarded-For': '8.8.8.8',
            },
          },
        );
        expect(response.status).toBe(201);
        const data = (await response.json()).data;
        expect(
          new Date(data.attempt.expiresAt) - new Date(data.attempt.createdAt),
        ).toBe(73000);
        expect(new URL(data.paymentUrl).searchParams.get('vnp_IpAddr')).toBe(
          '127.0.0.1',
        );
        const state = await snapshot(id);
        expect(
          state.order.reservation_expires_at - state.order.created_at,
        ).toBe(3600000);
      } finally {
        await other.close();
      }
    });
    test('provider maximum amount persists/signs exactly on PostgreSQL', async () => {
      const pid = await product('9999999999', 1);
      const order = await request('POST', '/orders', {
        items: [{ productId: pid, quantity: 1 }],
        shipping,
      });
      expect(order.status).toBe(201);
      const result = await initiate(order.body.data.id);
      expect(result.status).toBe(201);
      expect(result.body.data.attempt.amountVnd).toBe('9999999999');
      expect(
        new URL(result.body.data.paymentUrl).searchParams.get('vnp_Amount'),
      ).toBe('999999999900');
    });
    test('attempt state is reloaded after waiting on its payment lock', async () => {
      const { id } = await reserved();
      const paymentId = await attempt(id, 'FAILED');
      const blocker = await barrier('payments', paymentId);
      const pending = initiate(id);
      try {
        await waitLocks('payments', 1);
        await blocker.query(
          "UPDATE payments SET status='PENDING',terminal_at=NULL WHERE id=$1",
          [paymentId],
        );
        await blocker.commitTransaction();
        const result = await pending;
        expect(result.status).toBe(409);
        expect(result.body.error.code).toBe('PAYMENT_UNRESOLVED');
        const state = await snapshot(id);
        expect(state.attempts).toHaveLength(1);
        expect(state.attempts[0].status).toBe('PENDING');
      } finally {
        if (blocker.isTransactionActive) await blocker.rollbackTransaction();
        await blocker.release();
        await Promise.allSettled([pending]);
      }
    });

    test('Swagger advertises owner initiation and public callback/return boundaries', async () => {
      const spec = await (await fetch(app.base + '/api/docs-json')).json();
      const op = spec.paths['/api/v1/orders/{id}/payment-attempts'].post;
      expect(op.security).toEqual([{ bearer: [] }]);
      expect(
        op.responses['201'].content['application/json'].schema.properties.data
          .properties.reused.enum,
      ).toEqual([false]);
      expect(spec.paths['/api/v1/payments/vnpay/ipn'].get).toBeDefined();
      expect(spec.paths['/api/v1/payments/vnpay/return'].get).toBeDefined();
    });
  });
}
module.exports = { registerPaymentCases };
