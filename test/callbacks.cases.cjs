const {
  describe,
  beforeAll,
  afterAll,
  test,
  expect,
} = require('@jest/globals');
const { randomUUID, randomBytes, createHmac } = require('node:crypto');
const { URLSearchParams } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { startBuiltApplication } = require('./helpers/app-process.cjs');

function registerCallbackCases(getSource, appDatabase) {
  describe('Day12 verified VNPay callbacks and reconciliation on PostgreSQL', () => {
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
          email: `${randomUUID()}@callbacks.invalid`,
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

    let transactionSequence = 100000;
    function signed(fields, key = hashSecret) {
      const params = new URLSearchParams(
        Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1)),
      );
      const data = params
        .toString()
        .replace(/%7E/g, '~')
        .replace(/%21/g, '!')
        .replace(/%27/g, "'")
        .replace(/%28/g, '(')
        .replace(/%29/g, ')');
      return (
        data +
        '&vnp_SecureHash=' +
        createHmac('sha512', key).update(data, 'utf8').digest('hex')
      );
    }
    async function ipn(query, headers = {}) {
      const response = await fetch(
        app.base + '/api/v1/payments/vnpay/ipn?' + query,
        { headers },
      );
      return { status: response.status, body: await response.json() };
    }
    async function ready() {
      const pid = await product('10000', 10);
      const order = await request('POST', '/orders', {
        items: [{ productId: pid, quantity: 2 }],
        shipping,
      });
      expect(order.status).toBe(201);
      const started = await request(
        'POST',
        `/orders/${order.body.data.id}/payment-attempts`,
        {},
      );
      expect(started.status).toBe(201);
      const p = started.body.data.attempt;
      return {
        id: order.body.data.id,
        pid,
        paymentId: p.id,
        url: started.body.data.paymentUrl,
        fields: {
          vnp_TmnCode: 'FIXT0001',
          vnp_TxnRef: p.providerReference,
          vnp_Amount: '2000000',
          vnp_OrderInfo: 'Thanh toan don hang ' + p.providerReference,
          vnp_ResponseCode: '00',
          vnp_TransactionStatus: '00',
          vnp_TransactionNo: String(++transactionSequence),
          vnp_BankCode: 'NCB',
        },
      };
    }
    async function state(f) {
      return {
        order: (
          await source.query('SELECT * FROM orders WHERE id=$1', [f.id])
        )[0],
        payments: await source.query(
          'SELECT * FROM payments WHERE order_id=$1 ORDER BY id',
          [f.id],
        ),
        history: await source.query(
          'SELECT * FROM order_status_history WHERE order_id=$1 ORDER BY created_at,id',
          [f.id],
        ),
        stock: await row(f.pid),
      };
    }
    const receipts = (id) =>
      source.query(
        'SELECT * FROM payment_notifications WHERE payment_id=$1 ORDER BY received_at,id',
        [id],
      );
    const globalReceiptCount = async () =>
      +(
        await source.query(
          'SELECT count(*)::int AS n FROM payment_notifications',
        )
      )[0].n;
    async function block(table, id) {
      const runner = source.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      await runner.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [
        id,
      ]);
      return runner;
    }
    async function waitLocks(table, n) {
      const end = Date.now() + 12000;
      while (Date.now() < end) {
        const rows = await source.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1 AND query LIKE '%FOR UPDATE%'",
          ['%' + table + '%'],
        );
        if (rows[0].n >= n) return;
        await delay(15);
      }
      throw new Error('Expected callback/order independent lock waiters');
    }
    async function queued(id, first, second) {
      const runner = await block('orders', id);
      const pending = [];
      try {
        pending.push(first());
        await waitLocks('orders', 1);
        pending.push(second());
        await waitLocks('orders', 2);
        await runner.commitTransaction();
        return await Promise.all(pending);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await Promise.allSettled(pending);
      }
    }
    function expiryServices(batchSize = 1000) {
      const { ConfigService } = require('@nestjs/config');
      const {
        OrdersService,
      } = require('../dist/modules/orders/orders.service');
      const {
        ExpirationScanner,
      } = require('../dist/modules/expiration/expiration.scanner');
      const config = new ConfigService({
        expiry: { batchSize, scanIntervalSeconds: 86400 },
      });
      const orders = new OrdersService(source, config);
      return { orders, scanner: new ExpirationScanner(source, config, orders) };
    }
    async function overdue(f) {
      await source.query(
        "UPDATE orders SET created_at=clock_timestamp()-interval '2 hours',reservation_expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
        [f.id],
      );
    }
    function assertExpired(after) {
      expect(after.order.status).toBe('EXPIRED');
      expect(after.payments[0].status).toBe('EXPIRED');
      expect(after.payments[0].terminal_at).toBeInstanceOf(Date);
      expect(after.stock.stock_available).toBe(10);
      expect(after.history).toHaveLength(2);
      expect(after.history[1]).toMatchObject({
        new_status: 'EXPIRED',
        actor_user_id: null,
      });
    }
    test('Day13 repeated/overlapping scanners serialize real transactions and release/history once', async () => {
      const f = await ready();
      await overdue(f);
      const { scanner, orders } = expiryServices();
      const runner = await block('orders', f.id);
      const a = scanner.scan();
      const b = scanner.scan();
      expect(b).toBe(a);
      const other = orders.expire(f.id);
      try {
        await waitLocks('orders', 2);
        await runner.commitTransaction();
        await Promise.all([a, b, other]);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await Promise.allSettled([a, b, other]);
        await scanner.beforeApplicationShutdown();
      }
      expect(await orders.expire(f.id)).toBe(false);
      assertExpired(await state(f));
    });
    test('Day13 unresolved attempt target retains reservation and blocks replacement after scan', async () => {
      const f = await ready();
      await source.query(
        "UPDATE payments SET created_at=clock_timestamp()-interval '30 minutes',expires_at=clock_timestamp()-interval '10 minutes' WHERE id=$1",
        [f.paymentId],
      );
      const before = await state(f);
      await expiryServices().scanner.scan();
      expect(await state(f)).toEqual(before);
      expect(
        (await request('POST', `/orders/${f.id}/payment-attempts`, {})).body
          .error.code,
      ).toBe('PAYMENT_UNRESOLVED');
    });
    test('expiry protects stock when a pending-order fixture already has a successful payment', async () => {
      const f = await ready();
      await overdue(f);
      await source.query(
        "UPDATE payments SET status='SUCCESS',terminal_at=clock_timestamp() WHERE id=$1",
        [f.paymentId],
      );
      const before = await state(f);
      const { scanner, orders } = expiryServices();
      const output = [];
      const {
        SafeJsonLogger,
      } = require('../dist/common/logging/safe-json.logger');
      scanner.logger = new SafeJsonLogger((line) =>
        output.push(JSON.parse(line)),
      );
      try {
        await expect(orders.expire(f.id)).rejects.toMatchObject({
          code: 'ORDER_NOT_ELIGIBLE',
        });
        await scanner.scan();
        expect(await state(f)).toEqual(before);
        expect(output).toContainEqual(
          expect.objectContaining({
            event: 'expiry.failed',
            orderId: f.id,
            diagnostic: 'ORDER_NOT_ELIGIBLE',
          }),
        );
      } finally {
        // Remove the deliberate inconsistent fixture so later recovery scans are isolated.
        await source.query("UPDATE payments SET status='FAILED' WHERE id=$1", [
          f.paymentId,
        ]);
        await orders.expire(f.id);
      }
    });
    test('Day13 startup recovers downtime and configured periodic scan recovers later orders', async () => {
      const f = await ready();
      await overdue(f);
      const recovery = await startBuiltApplication(appDatabase(), {
        scanIntervalSeconds: 1,
        scanBatchSize: 1000,
      });
      try {
        assertExpired(await state(f));
        const g = await ready();
        await overdue(g);
        const end = Date.now() + 8000;
        while (
          (await state(g)).order.status === 'PENDING_PAYMENT' &&
          Date.now() < end
        )
          await delay(25);
        assertExpired(await state(g));
      } finally {
        await recovery.close();
      }
    });
    test('Day13 expiry history fault rolls back release/payment and candidate failure permits later recovery', async () => {
      const f = await ready(),
        g = await ready();
      await overdue(f);
      await overdue(g);
      const before = await state(f);
      const constraint = 'expiry_fault_' + randomBytes(8).toString('hex');
      await source.query(
        `ALTER TABLE order_status_history ADD CONSTRAINT ${constraint} CHECK (order_id <> '${f.id}'::uuid OR new_status <> 'EXPIRED')`,
      );
      const { scanner, orders } = expiryServices();
      const output = [];
      const {
        SafeJsonLogger,
      } = require('../dist/common/logging/safe-json.logger');
      scanner.logger = new SafeJsonLogger((line) =>
        output.push(JSON.parse(line)),
      );
      try {
        await expect(orders.expire(f.id)).rejects.toBeDefined();
        expect(await state(f)).toEqual(before);
        await scanner.scan();
        assertExpired(await state(g));
        expect(await state(f)).toEqual(before);
        expect(output).toContainEqual(
          expect.objectContaining({
            event: 'expiry.failed',
            orderId: f.id,
            diagnostic: '23514',
          }),
        );
        expect(JSON.stringify(output)).not.toContain(f.url);
      } finally {
        await source.query(
          `ALTER TABLE order_status_history DROP CONSTRAINT ${constraint}`,
        );
      }
      await scanner.scan();
      await scanner.scan();
      assertExpired(await state(f));
    });
    test.each(['ipn-first', 'expiry-first'])(
      'Day13 overdue %s expiry race keeps late callback non-settling',
      async (kind) => {
        const f = await ready();
        await overdue(f);
        const { orders } = expiryServices();
        const settle = () => ipn(signed(f.fields));
        const expire = () => orders.expire(f.id);
        await queued(
          f.id,
          kind === 'ipn-first' ? settle : expire,
          kind === 'ipn-first' ? expire : settle,
        );
        assertExpired(await state(f));
        expect((await receipts(f.paymentId)).map((r) => r.outcome)).toEqual([
          'LATE',
        ]);
      },
    );
    test('Day13 settlement winner makes stale expiry candidate harmless', async () => {
      const f = await ready();
      await queued(
        f.id,
        () => ipn(signed(f.fields)),
        () => expiryServices().orders.expire(f.id),
      );
      const after = await state(f);
      expect(after.order.status).toBe('PAID');
      expect(after.payments[0].status).toBe('SUCCESS');
      expect(after.stock.stock_available).toBe(8);
      expect(after.history).toHaveLength(2);
      expect(
        (await receipts(f.paymentId)).filter((r) => r.outcome === 'SETTLED'),
      ).toHaveLength(1);
    });
    test.each(['cancel-first', 'expiry-first'])(
      'Day13 overdue %s cancellation race releases only once',
      async (kind) => {
        const f = await ready();
        await overdue(f);
        const cancel = () => request('POST', `/orders/${f.id}/cancel`, {});
        const expire = () => expiryServices().orders.expire(f.id);
        const results = await queued(
          f.id,
          kind === 'cancel-first' ? cancel : expire,
          kind === 'cancel-first' ? expire : cancel,
        );
        expect(results[kind === 'cancel-first' ? 0 : 1].body.error.code).toBe(
          'ORDER_NOT_ELIGIBLE',
        );
        assertExpired(await state(f));
      },
    );
    test('Day13 cancellation winner makes stale expiry candidate harmless', async () => {
      const f = await ready();
      await queued(
        f.id,
        () => request('POST', `/orders/${f.id}/cancel`, {}),
        () => expiryServices().orders.expire(f.id),
      );
      const after = await state(f);
      expect(after.order.status).toBe('CANCELLED');
      expect(after.stock.stock_available).toBe(10);
      expect(after.history).toHaveLength(2);
      expect(after.payments[0].status).toBe('EXPIRED');
    });
    test('Day13 candidate rechecks current deadline after order-lock wait', async () => {
      const f = await ready();
      await overdue(f);
      const runner = await block('orders', f.id);
      const { scanner } = expiryServices();
      const pending = scanner.scan();
      try {
        await waitLocks('orders', 1);
        await runner.query(
          "UPDATE orders SET reservation_expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1",
          [f.id],
        );
        await runner.commitTransaction();
        await pending;
        const after = await state(f);
        expect(after.order.status).toBe('PENDING_PAYMENT');
        expect(after.stock.stock_available).toBe(8);
        expect(after.history).toHaveLength(1);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await pending;
      }
    });
    test.each(['adjust-first', 'release-first'])(
      'Day13 %s adjustment-versus-release has no lost stock update',
      async (kind) => {
        const f = await ready();
        await overdue(f);
        const runner = await block('products', f.pid);
        const {
          InventoryService,
        } = require('../dist/modules/inventory/inventory.service');
        const adjust = () =>
          new InventoryService(source).adjust(actors.ADMIN.id, f.pid, {
            quantityDelta: 3,
            reason: 'Expiry race',
          });
        const release = () => expiryServices().orders.expire(f.id);
        const tasks = [];
        try {
          tasks.push(kind === 'adjust-first' ? adjust() : release());
          await waitLocks('products', 1);
          tasks.push(kind === 'adjust-first' ? release() : adjust());
          await waitLocks('products', 2);
          await runner.commitTransaction();
          await Promise.all(tasks);
          const after = await state(f);
          expect(after.order.status).toBe('EXPIRED');
          expect(after.stock.stock_available).toBe(13);
          expect(after.history).toHaveLength(2);
          const audit = await source.query(
            'SELECT * FROM inventory_adjustment_audit WHERE product_id=$1',
            [f.pid],
          );
          expect(audit).toHaveLength(1);
          expect(audit[0].previous_stock).toBe(
            kind === 'adjust-first' ? 8 : 10,
          );
        } finally {
          if (runner.isTransactionActive) await runner.rollbackTransaction();
          await runner.release();
          await Promise.allSettled(tasks);
        }
      },
    );

    test('valid public IPN atomically settles without JWT/currency/optional fields or a second stock deduction', async () => {
      const f = await ready();
      const before = await state(f);
      const query = signed(f.fields);
      const result = await ipn(query, {
        Authorization: 'Bearer invalid-human-token',
      });
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ RspCode: '00', Message: 'Handled' });
      expect(result.body).not.toHaveProperty('success');
      const after = await state(f);
      expect(after.order.status).toBe('PAID');
      expect(after.payments[0]).toMatchObject({
        status: 'SUCCESS',
        provider_transaction_reference: f.fields.vnp_TransactionNo,
        response_code: '00',
        transaction_status_code: '00',
      });
      expect(after.payments[0].terminal_at).toBeInstanceOf(Date);
      expect(after.stock).toEqual(before.stock);
      expect(after.history).toHaveLength(2);
      expect(after.history[1]).toMatchObject({
        previous_status: 'PENDING_PAYMENT',
        new_status: 'PAID',
        actor_user_id: null,
      });
      const observed = await receipts(f.paymentId);
      expect(observed).toHaveLength(1);
      expect(observed[0]).toMatchObject({
        outcome: 'SETTLED',
        signature_verified: true,
        reported_amount_vnd: '20000',
        reported_currency: 'VND',
      });
      expect(JSON.stringify(observed)).not.toMatch(
        /vnp_SecureHash|vnp_OrderInfo/,
      );
      expect(app.output()).not.toContain(query);
      expect(app.output()).not.toContain(hashSecret);
    });
    test('applicable verified failure retains order reservation and stock, then allows a real replacement initiation', async () => {
      const f = await ready();
      const before = await state(f);
      const fields = {
        ...f.fields,
        vnp_ResponseCode: '24',
        vnp_TransactionStatus: '02',
        vnp_TransactionNo: '0',
      };
      delete fields.vnp_BankCode;
      expect((await ipn(signed(fields))).body.RspCode).toBe('00');
      const after = await state(f);
      expect(after.payments[0]).toMatchObject({
        status: 'FAILED',
        response_code: '24',
        transaction_status_code: '02',
        provider_transaction_reference: '0',
      });
      expect(after.order).toEqual(before.order);
      expect(after.stock).toEqual(before.stock);
      expect(after.history).toEqual(before.history);
      expect((await receipts(f.paymentId))[0].outcome).toBe('FAILED');
      const replacement = await request(
        'POST',
        `/orders/${f.id}/payment-attempts`,
        {},
      );
      expect(replacement.status).toBe(201);
      expect(replacement.body.data.attempt.id).not.toBe(f.paymentId);
      expect((await ipn(signed(fields))).body.RspCode).toBe('02');
      expect(
        (await state(f)).payments.filter((p) => p.status === 'PENDING'),
      ).toHaveLength(1);
    });
    test.each(['success', 'failure'])(
      'repeated/concurrent %s callbacks have one business effect and distinct durable receipts',
      async (kind) => {
        const f = await ready();
        const fields =
          kind === 'success'
            ? f.fields
            : {
                ...f.fields,
                vnp_ResponseCode: '24',
                vnp_TransactionStatus: '02',
                vnp_TransactionNo: '0',
              };
        const query = signed(fields);
        const before = await state(f);
        const results = await queued(
          f.id,
          () => ipn(query),
          () => ipn(query),
        );
        expect(results.map((r) => r.body.RspCode)).toEqual(['00', '02']);
        expect((await ipn(query)).body.RspCode).toBe('02');
        const after = await state(f);
        expect(after.payments[0].status).toBe(
          kind === 'success' ? 'SUCCESS' : 'FAILED',
        );
        expect(after.history).toHaveLength(kind === 'success' ? 2 : 1);
        expect(after.stock).toEqual(before.stock);
        expect((await receipts(f.paymentId)).map((r) => r.outcome)).toEqual([
          kind === 'success' ? 'SETTLED' : 'FAILED',
          'DUPLICATE',
          'DUPLICATE',
        ]);
      },
    );
    test.each([
      'signature',
      'duplicate',
      'encoded-duplicate',
      'malformed',
      'unknown-field',
      'oversized',
      'unknown-reference',
      'merchant',
      'amount',
      'fractional-amount',
      'currency',
      'description',
      'environment',
    ])(
      '%s rejection persists a bounded receipt and preserves every business row',
      async (kind) => {
        const f = await ready();
        let fields = { ...f.fields },
          query;
        if (kind === 'unknown-reference') fields.vnp_TxnRef = 'unknown123';
        if (kind === 'merchant') fields.vnp_TmnCode = 'WRNG0001';
        if (kind === 'amount') fields.vnp_Amount = '2000100';
        if (kind === 'fractional-amount') fields.vnp_Amount = '2000001';
        if (kind === 'currency') fields.vnp_CurrCode = 'USD';
        if (kind === 'description') fields.vnp_OrderInfo = 'other order';
        if (kind === 'environment')
          await source.query(
            "UPDATE payments SET payment_url=replace(payment_url,'sandbox.vnpayment.vn','other.invalid') WHERE id=$1",
            [f.paymentId],
          );
        query = signed(
          fields,
          kind === 'signature' ? 'incorrect-secret' : hashSecret,
        );
        if (kind === 'duplicate') query += '&vnp_Amount=2000000';
        if (kind === 'encoded-duplicate') query += '&%76np_Amount=2000000';
        if (kind === 'malformed') query += '&vnp_OrderInfo=%C0%AF';
        if (kind === 'unknown-field') query += '&vnp_Debug=private';
        if (kind === 'oversized') query += '&a=' + 'x'.repeat(8200);
        const before = await state(f),
          count = await globalReceiptCount();
        const result = await ipn(query);
        const invalid = [
          'signature',
          'duplicate',
          'encoded-duplicate',
          'malformed',
          'unknown-field',
          'oversized',
        ].includes(kind);
        expect(result.body.RspCode).toBe(
          invalid
            ? '97'
            : ['unknown-reference', 'merchant', 'environment'].includes(kind)
              ? '01'
              : ['amount', 'currency', 'fractional-amount'].includes(kind)
                ? '04'
                : '00',
        );
        expect(await state(f)).toEqual(before);
        expect(await globalReceiptCount()).toBe(count + 1);
        const last = (
          await source.query(
            'SELECT * FROM payment_notifications ORDER BY received_at DESC,id DESC LIMIT 1',
          )
        )[0];
        expect(last.outcome).toBe(
          invalid
            ? 'INVALID'
            : ['unknown-reference', 'merchant'].includes(kind)
              ? 'UNKNOWN_REFERENCE'
              : 'MISMATCH',
        );
        expect(last.signature_verified).toBe(!invalid);
        expect(JSON.stringify(last)).not.toContain(query);
        expect(last.safe_detail.length).toBeLessThanOrEqual(64);
        if (invalid) expect(last.provider_reference).toBeNull();
      },
    );
    test.each([
      ['07', '07'],
      ['00', '01'],
      ['00', '02'],
      ['99', '04'],
      ['00', '00'],
    ])(
      'ambiguous result %s/%s never releases/replaces/settles',
      async (response, status) => {
        const f = await ready();
        const before = await state(f);
        const fields = {
          ...f.fields,
          vnp_ResponseCode: response,
          vnp_TransactionStatus: status,
        };
        if (response === '00' && status === '00')
          fields.vnp_TransactionNo = '0';
        expect((await ipn(signed(fields))).body.RspCode).toBe('00');
        expect(await state(f)).toEqual(before);
        expect((await receipts(f.paymentId))[0].outcome).toBe('CONFLICT');
        expect(
          (await request('POST', `/orders/${f.id}/payment-attempts`, {})).body
            .error.code,
        ).toBe('PAYMENT_UNRESOLVED');
      },
    );
    test.each(['attempt', 'order'])(
      '%s deadline is rechecked after order lock wait without terminalizing pending state',
      async (kind) => {
        const f = await ready(),
          blocker = await block('orders', f.id);
        const pending = ipn(signed(f.fields));
        try {
          await waitLocks('orders', 1);
          if (kind === 'order')
            await blocker.query(
              "UPDATE orders SET created_at=clock_timestamp()-interval '2 hours',reservation_expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",
              [f.id],
            );
          else
            await blocker.query(
              "UPDATE payments SET created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",
              [f.paymentId],
            );
          await blocker.commitTransaction();
          expect((await pending).body.RspCode).toBe('00');
          const after = await state(f);
          expect(after.order.status).toBe('PENDING_PAYMENT');
          expect(after.payments[0].status).toBe('PENDING');
          expect(after.history).toHaveLength(1);
          expect(after.stock.stock_available).toBe(8);
          expect((await receipts(f.paymentId))[0].outcome).toBe('LATE');
        } finally {
          if (blocker.isTransactionActive) await blocker.rollbackTransaction();
          await blocker.release();
          await Promise.allSettled([pending]);
        }
      },
    );
    test.each(['SUCCESS', 'FAILED', 'EXPIRED'])(
      'terminal %s canonical outcome cannot be overwritten by changed/muâ€‹tated callback',
      async (status) => {
        const f = await ready();
        if (status === 'EXPIRED')
          await source.query(
            "UPDATE payments SET status='EXPIRED',terminal_at=clock_timestamp() WHERE id=$1",
            [f.paymentId],
          );
        else
          expect(
            (
              await ipn(
                signed(
                  status === 'SUCCESS'
                    ? f.fields
                    : {
                        ...f.fields,
                        vnp_ResponseCode: '24',
                        vnp_TransactionStatus: '02',
                      },
                ),
              )
            ).body.RspCode,
          ).toBe('00');
        const before = await state(f);
        const changed = {
          ...f.fields,
          vnp_TransactionNo: '99999999',
          vnp_ResponseCode: status === 'SUCCESS' ? '24' : '00',
          vnp_TransactionStatus: status === 'SUCCESS' ? '02' : '00',
        };
        expect((await ipn(signed(changed))).body.RspCode).toBe('00');
        expect(await state(f)).toEqual(before);
        expect((await receipts(f.paymentId)).at(-1).outcome).toBe(
          status === 'EXPIRED' ? 'LATE' : 'CONFLICT',
        );
      },
    );
    test.each(['history', 'receipt', 'payment', 'order'])(
      'fault injected at %s rolls back settlement and does not ACK success; retry settles once',
      async (stage) => {
        const f = await ready(),
          before = await state(f);
        const name = 'callback_fault_' + randomBytes(8).toString('hex');
        const table = {
          history: 'order_status_history',
          receipt: 'payment_notifications',
          payment: 'payments',
          order: 'orders',
        }[stage];
        const clause =
          stage === 'history'
            ? `order_id <> '${f.id}'::uuid OR new_status <> 'PAID'`
            : stage === 'receipt'
              ? `payment_id <> '${f.paymentId}'::uuid`
              : stage === 'payment'
                ? `id <> '${f.paymentId}'::uuid OR status='PENDING'`
                : `id <> '${f.id}'::uuid OR status='PENDING_PAYMENT'`;
        await source.query(
          `ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${clause}) NOT VALID`,
        );
        try {
          const result = await ipn(signed(f.fields));
          expect(result.status).toBe(200);
          expect(result.body).toEqual({
            RspCode: '99',
            Message: 'Processing error',
          });
          expect(await state(f)).toEqual(before);
          expect(await receipts(f.paymentId)).toHaveLength(0);
          expect(JSON.stringify(result.body)).not.toContain(name);
        } finally {
          await source.query(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
        }
        expect((await ipn(signed(f.fields))).body.RspCode).toBe('00');
        expect((await state(f)).history).toHaveLength(2);
        expect((await receipts(f.paymentId)).map((r) => r.outcome)).toEqual([
          'SETTLED',
        ]);
      },
    );
    test('failure-receipt and invalid-receipt faults also require retry and preserve prior state', async () => {
      const f = await ready(),
        before = await state(f),
        name = 'receipt_fault_' + randomBytes(8).toString('hex');
      await source.query(
        `ALTER TABLE payment_notifications ADD CONSTRAINT ${name} CHECK (false) NOT VALID`,
      );
      try {
        expect(
          (
            await ipn(
              signed({
                ...f.fields,
                vnp_ResponseCode: '24',
                vnp_TransactionStatus: '02',
              }),
            )
          ).body.RspCode,
        ).toBe('99');
        expect((await ipn('bad=query')).body.RspCode).toBe('99');
        expect(await state(f)).toEqual(before);
        expect(await receipts(f.paymentId)).toHaveLength(0);
      } finally {
        await source.query(
          `ALTER TABLE payment_notifications DROP CONSTRAINT ${name}`,
        );
      }
      expect((await ipn('bad=query')).body.RspCode).toBe('97');
    });
    test.each(['cancel-first', 'settle-first'])(
      '%s cancellation-versus-settlement serializes with one final order and no double inventory effect',
      async (kind) => {
        const f = await ready();
        const settle = () => ipn(signed(f.fields));
        const cancel = () => request('POST', `/orders/${f.id}/cancel`, {});
        const results = await queued(
          f.id,
          kind === 'cancel-first' ? cancel : settle,
          kind === 'cancel-first' ? settle : cancel,
        );
        const after = await state(f);
        expect(after.history).toHaveLength(2);
        if (kind === 'cancel-first') {
          expect(results[0].status).toBe(200);
          expect(results[1].body.RspCode).toBe('00');
          expect(after.order.status).toBe('CANCELLED');
          expect(after.payments[0].status).toBe('EXPIRED');
          expect(after.stock.stock_available).toBe(10);
          expect((await receipts(f.paymentId))[0].outcome).toBe('LATE');
          expect(
            (await request('POST', `/orders/${f.id}/cancel`, {})).body.data
              .changed,
          ).toBe(false);
        } else {
          expect(results[0].body.RspCode).toBe('00');
          expect(results[1].status).toBe(409);
          expect(after.order.status).toBe('PAID');
          expect(after.payments[0].status).toBe('SUCCESS');
          expect(after.stock.stock_available).toBe(8);
          expect((await receipts(f.paymentId))[0].outcome).toBe('SETTLED');
        }
      },
    );
    test('different attempts serialize under the same order and one-success index remains enforced', async () => {
      const f = await ready();
      expect(
        (
          await ipn(
            signed({
              ...f.fields,
              vnp_ResponseCode: '24',
              vnp_TransactionStatus: '02',
            }),
          )
        ).body.RspCode,
      ).toBe('00');
      const next = await request(
        'POST',
        `/orders/${f.id}/payment-attempts`,
        {},
      );
      expect(next.status).toBe(201);
      const p = next.body.data.attempt;
      const newFields = {
        ...f.fields,
        vnp_TxnRef: p.providerReference,
        vnp_OrderInfo: 'Thanh toan don hang ' + p.providerReference,
        vnp_TransactionNo: '33333333',
      };
      const results = await queued(
        f.id,
        () => ipn(signed(f.fields)),
        () => ipn(signed(newFields)),
      );
      expect(results.map((r) => r.body.RspCode)).toEqual(['00', '00']);
      const after = await state(f);
      expect(after.payments.filter((p) => p.status === 'SUCCESS')).toHaveLength(
        1,
      );
      expect(after.payments.find((p) => p.id === f.paymentId).status).toBe(
        'FAILED',
      );
      expect(after.order.status).toBe('PAID');
      expect(after.history).toHaveLength(2);
      expect(after.stock.stock_available).toBe(8);
      await expect(
        source.query(
          "UPDATE payments SET status='SUCCESS',terminal_at=clock_timestamp() WHERE id=$1",
          [f.paymentId],
        ),
      ).rejects.toMatchObject({ driverError: { code: '23505' } });
    });
    test('browser return verifies only a minimal signed echo, never settles, leaks stored data or writes receipts', async () => {
      const f = await ready(),
        before = await state(f),
        count = await globalReceiptCount();
      const result = await request(
        'GET',
        '/payments/vnpay/return?' + signed(f.fields),
        undefined,
        null,
      );
      expect(result.status).toBe(200);
      expect(result.body.data).toEqual({
        reference: f.fields.vnp_TxnRef,
        providerResponseCode: '00',
        settlementAuthoritative: false,
      });
      expect(result.cache).toBe('no-store');
      expect(await state(f)).toEqual(before);
      expect(await globalReceiptCount()).toBe(count);
      expect(
        (
          await request(
            'GET',
            '/payments/vnpay/return?' + signed(f.fields, 'wrong-key'),
            undefined,
            null,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await request(
            'GET',
            '/payments/vnpay/return?' +
              signed({ ...f.fields, vnp_TmnCode: 'WRNG0001' }),
            undefined,
            null,
          )
        ).status,
      ).toBe(400);
      expect(JSON.stringify(result.body)).not.toMatch(
        /paymentUrl|shipping|customerId|vnp_SecureHash/,
      );
    });
    test.each([null, 'A', 'STAFF'])(
      '%s cannot inspect Admin reconciliation or change provider state',
      async (actor) => {
        const f = await ready(),
          before = await state(f);
        for (const path of [
          '/admin/payments',
          `/admin/payments/${f.paymentId}`,
          `/admin/payments/${f.paymentId}/notifications`,
        ])
          expect((await request('GET', path, undefined, actor)).status).toBe(
            actor ? 403 : 401,
          );
        expect(await state(f)).toEqual(before);
      },
    );
    test('Admin exact-filter pagination/receipts are read-only and contain only safe canonical fields', async () => {
      const f = await ready();
      await ipn(signed(f.fields));
      await ipn(signed(f.fields));
      const before = await state(f);
      const list = await request(
        'GET',
        `/admin/payments?orderId=${f.id}&status=SUCCESS&providerReference=${f.fields.vnp_TxnRef}&limit=1`,
        undefined,
        'ADMIN',
      );
      expect(list.status).toBe(200);
      expect(list.body.data.total).toBe(1);
      expect(list.body.data.items[0]).toMatchObject({
        id: f.paymentId,
        orderId: f.id,
        providerTransactionReference: f.fields.vnp_TransactionNo,
      });
      const detail = await request(
        'GET',
        `/admin/payments/${f.paymentId}`,
        undefined,
        'ADMIN',
      );
      expect(detail.body.data).toEqual(list.body.data.items[0]);
      expect(detail.cache).toBe('no-store');
      const observed = await request(
        'GET',
        `/admin/payments/${f.paymentId}/notifications?offset=1&limit=1`,
        undefined,
        'ADMIN',
      );
      expect(observed.body.data.total).toBe(2);
      expect(observed.body.data.items[0].outcome).toBe('DUPLICATE');
      expect(
        JSON.stringify([list.body, detail.body, observed.body]),
      ).not.toMatch(/paymentUrl|vnp_SecureHash|vnp_OrderInfo/);
      for (const query of [
        'status=WRONG',
        'orderId=bad',
        'limit=101',
        'offset=-1',
        'sort=id',
        'providerReference=' + 'a'.repeat(101),
        'status=SUCCESS&status=FAILED',
      ])
        expect(
          (await request('GET', '/admin/payments?' + query, undefined, 'ADMIN'))
            .status,
        ).toBe(400);
      for (const path of [
        `/admin/payments/${randomUUID()}`,
        `/admin/payments/${randomUUID()}/notifications`,
      ])
        expect((await request('GET', path, undefined, 'ADMIN')).status).toBe(
          404,
        );
      expect(
        (
          await request(
            'POST',
            `/admin/payments/${f.paymentId}`,
            { status: 'SUCCESS' },
            'ADMIN',
          )
        ).status,
      ).toBe(404);
      expect(await state(f)).toEqual(before);
    });
    test('deferred COMMIT failure never emits a durable-success acknowledgement', async () => {
      const f = await ready(),
        before = await state(f);
      const suffix = randomBytes(8).toString('hex');
      const fn = 'callback_commit_' + suffix,
        trigger = 'callback_commit_trigger_' + suffix;
      await source.query(
        `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payment_id = '${f.paymentId}'::uuid THEN RAISE EXCEPTION 'controlled deferred commit failure'; END IF; RETURN NEW; END $$`,
      );
      await source.query(
        `CREATE CONSTRAINT TRIGGER ${trigger} AFTER INSERT ON payment_notifications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
      );
      try {
        const result = await ipn(signed(f.fields));
        expect(result.body).toEqual({
          RspCode: '99',
          Message: 'Processing error',
        });
        expect(await state(f)).toEqual(before);
        expect(await receipts(f.paymentId)).toHaveLength(0);
      } finally {
        await source.query(`DROP TRIGGER ${trigger} ON payment_notifications`);
        await source.query(`DROP FUNCTION ${fn}()`);
      }
      expect((await ipn(signed(f.fields))).body.RspCode).toBe('00');
      expect((await receipts(f.paymentId))[0].outcome).toBe('SETTLED');
    });
    test('settlement acquires order then attempts in ID order and records post-wait wall clock', async () => {
      const f = await ready();
      await source.query(
        "INSERT INTO payments(id,order_id,provider_reference,status,amount_vnd,payment_url,expires_at,terminal_at) VALUES ($1,$2,$3,'FAILED',20000,$4,clock_timestamp()+interval '20 minutes',clock_timestamp())",
        [randomUUID(), f.id, randomUUID().replaceAll('-', ''), f.url],
      );
      const attempts = (await state(f)).payments;
      const blocker = await block('payments', attempts[1].id);
      const probe = source.createQueryRunner();
      const pending = ipn(signed(f.fields));
      try {
        await waitLocks('payments', 1);
        await probe.connect();
        for (const [table, id] of [
          ['orders', f.id],
          ['payments', attempts[0].id],
        ]) {
          await probe.startTransaction();
          await expect(
            probe.query(
              `SELECT id FROM ${table} WHERE id=$1 FOR UPDATE NOWAIT`,
              [id],
            ),
          ).rejects.toMatchObject({ driverError: { code: '55P03' } });
          await probe.rollbackTransaction();
        }
        const marker = (
          await blocker.query('SELECT clock_timestamp() AS time')
        )[0].time;
        await blocker.commitTransaction();
        expect((await pending).body.RspCode).toBe('00');
        const after = await state(f);
        expect(after.order.status).toBe('PAID');
        expect(after.history[1].created_at.getTime()).toBeGreaterThanOrEqual(
          marker.getTime(),
        );
        expect(after.stock.stock_available).toBe(8);
      } finally {
        if (probe.isTransactionActive) await probe.rollbackTransaction();
        await probe.release();
        if (blocker.isTransactionActive) await blocker.rollbackTransaction();
        await blocker.release();
        await Promise.allSettled([pending]);
      }
    });
    test('terminal attempt state is reloaded after its payment-lock wait', async () => {
      const f = await ready(),
        blocker = await block('payments', f.paymentId),
        pending = ipn(signed(f.fields));
      try {
        await waitLocks('payments', 1);
        await blocker.query(
          "UPDATE payments SET status='EXPIRED',terminal_at=clock_timestamp() WHERE id=$1",
          [f.paymentId],
        );
        await blocker.commitTransaction();
        expect((await pending).body.RspCode).toBe('00');
        const after = await state(f);
        expect(after.payments[0].status).toBe('EXPIRED');
        expect(after.order.status).toBe('PENDING_PAYMENT');
        expect(after.history).toHaveLength(1);
        expect(after.stock.stock_available).toBe(8);
        expect((await receipts(f.paymentId))[0].outcome).toBe('LATE');
      } finally {
        if (blocker.isTransactionActive) await blocker.rollbackTransaction();
        await blocker.release();
        await Promise.allSettled([pending]);
      }
    });
    test.each(['20000101000000', '20990101000000'])(
      'optional PayDate %s outside applicable interval is non-settling mismatch',
      async (date) => {
        const f = await ready(),
          before = await state(f);
        expect(
          (await ipn(signed({ ...f.fields, vnp_PayDate: date }))).body.RspCode,
        ).toBe('00');
        expect(await state(f)).toEqual(before);
        expect((await receipts(f.paymentId))[0]).toMatchObject({
          outcome: 'MISMATCH',
          safe_detail: 'PAY_DATE_CONTEXT',
        });
      },
    );
    test('valid optional payment date and bank observations verify without persisting raw fields', async () => {
      const f = await ready();
      const date = new Date(Date.now() + 7 * 3600000)
        .toISOString()
        .slice(0, 19)
        .replace(/[-:T]/g, '');
      expect(
        (
          await ipn(
            signed({
              ...f.fields,
              vnp_PayDate: date,
              vnp_BankTranNo: 'VNP1234567',
              vnp_CardType: 'ATM',
              vnp_CurrCode: 'VND',
            }),
          )
        ).body.RspCode,
      ).toBe('00');
      expect((await state(f)).order.status).toBe('PAID');
      expect(JSON.stringify(await receipts(f.paymentId))).not.toMatch(
        /VNP1234567|vnp_PayDate|ATM/,
      );
    });

    test('duplicate successful callback after fulfillment never adds history or reverts order', async () => {
      const f = await ready();
      expect((await ipn(signed(f.fields))).body.RspCode).toBe('00');
      for (const status of ['PROCESSING', 'SHIPPED', 'COMPLETED'])
        expect(
          (
            await request(
              'POST',
              `/staff/orders/${f.id}/status`,
              { status },
              'STAFF',
            )
          ).status,
        ).toBe(200);
      const before = await state(f);
      expect((await ipn(signed(f.fields))).body.RspCode).toBe('02');
      expect(await state(f)).toEqual(before);
      expect(before.order.status).toBe('COMPLETED');
    });
    test('inconsistent pending order with an existing successful predecessor records conflict without violating one-success', async () => {
      const f = await ready();
      await source.query(
        "INSERT INTO payments(id,order_id,provider_reference,status,amount_vnd,payment_url,expires_at,terminal_at) VALUES ($1,$2,$3,'SUCCESS',20000,$4,clock_timestamp()+interval '20 minutes',clock_timestamp())",
        [randomUUID(), f.id, randomUUID().replaceAll('-', ''), f.url],
      );
      const before = await state(f);
      expect((await ipn(signed(f.fields))).body.RspCode).toBe('00');
      expect(await state(f)).toEqual(before);
      expect((await receipts(f.paymentId))[0]).toMatchObject({
        outcome: 'CONFLICT',
        safe_detail: 'EXISTING_SUCCESS',
      });
    });

    test('global GET body validation uses retryable provider99, never a JSON envelope', async () => {
      const http = require('node:http');
      const result = await new Promise((resolve, reject) => {
        const url = new URL(app.base + '/api/v1/payments/vnpay/ipn');
        const req = http.request(
          url,
          {
            method: 'GET',
            headers: {
              'content-type': 'application/json',
              'content-length': '2',
            },
          },
          (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () =>
              resolve({ status: res.statusCode, body: JSON.parse(body) }),
            );
          },
        );
        req.on('error', reject);
        req.end('{}');
      });
      expect(result).toEqual({
        status: 200,
        body: { RspCode: '99', Message: 'Processing error' },
      });
    });
  });
}
module.exports = { registerCallbackCases };
