const { randomBytes, randomUUID, scryptSync } = require('node:crypto');
const { Buffer } = require('node:buffer');
const { TextEncoder } = require('node:util');
const { describe } = require('@jest/globals');
const { registerAccountCases } = require('./accounts.cases.cjs');
const { registerProductCases } = require('./products.cases.cjs');
const { createDataSource } = require('../dist/database/data-source');
const { databaseConfig } = require('../dist/config/database.config');
const { startBuiltApplication } = require('./helpers/app-process.cjs');
const { entities } = require('../dist/database/entity-registry');
const { User } = require('../dist/modules/users/entities/user.entity');
const { Product } = require('../dist/modules/products/entities/product.entity');
const { Order } = require('../dist/modules/orders/entities/order.entity');
const {
  OrderItem,
} = require('../dist/modules/orders/entities/order-item.entity');
const {
  RefreshToken,
} = require('../dist/modules/auth/entities/refresh-token.entity');
const { Payment } = require('../dist/modules/payments/entities/payment.entity');
const {
  RoleChangeAudit,
} = require('../dist/modules/users/entities/role-change-audit.entity');
const {
  InventoryAdjustmentAudit,
} = require('../dist/modules/inventory/entities/inventory-adjustment-audit.entity');
const {
  OrderStatusHistory,
} = require('../dist/modules/orders/entities/order-status-history.entity');
const {
  PaymentNotification,
} = require('../dist/modules/payments/entities/payment-notification.entity');
const {
  seedDevelopment,
  developmentProducts,
} = require('../dist/database/seeds/development.seed');
const {
  adminInput,
  setupInitialAdmin,
} = require('../dist/database/seeds/initial-admin');

let source;

function appDatabase() {
  return {
    host: '127.0.0.1',
    port: process.env.TEST_DB_PORT,
    username: 'shop_test',
    database: 'shop_test',
    password: process.env.TEST_DB_PASSWORD,
  };
}

beforeAll(async () => {
  if (
    !/^nestshop-it-[a-f0-9]{12}$/.test(process.env.TEST_DB_DISPOSABLE ?? '') ||
    process.env.TEST_DB_HOST !== '127.0.0.1'
  ) {
    throw new Error(
      'Use npm run test:integration; refusing an unverified test DB target',
    );
  }
  source = createDataSource(
    databaseConfig({
      NODE_ENV: 'test',
      DB_HOST: '127.0.0.1',
      DB_PORT: process.env.TEST_DB_PORT,
      DB_USERNAME: 'shop_test',
      DB_DATABASE: 'shop_test',
      DB_PASSWORD: process.env.TEST_DB_PASSWORD,
    }),
  );
  await source.initialize();
  expect(
    await source.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public'",
    ),
  ).toHaveLength(0);
  await source.runMigrations();
});

afterAll(async () => {
  if (source?.isInitialized) await source.destroy();
});

async function fixture() {
  const user = await source.getRepository(User).save(
    source.getRepository(User).create({
      email: `${randomUUID()}@test.invalid`,
      passwordHash: 'fixture-hash-not-auth-evidence',
    }),
  );
  const product = await source.getRepository(Product).save(
    source.getRepository(Product).create({
      name: 'Precision fixture',
      priceVnd: '9007199254740993',
      stockAvailable: 10,
    }),
  );
  const order = await source.getRepository(Order).save(
    source.getRepository(Order).create({
      userId: user.id,
      totalVnd: product.priceVnd,
      recipientName: 'Test recipient',
      recipientPhone: '+84901234567',
      addressLine: 'Test address',
      provinceCity: 'Test province',
      reservationExpiresAt: new Date(Date.now() + 3600000),
    }),
  );
  return { user, product, order };
}

function token(user, overrides = {}) {
  return source.getRepository(RefreshToken).create({
    userId: user.id,
    familyId: randomUUID(),
    tokenHash: randomBytes(32).toString('hex'),
    expiresAt: new Date(Date.now() + 600000),
    ...overrides,
  });
}

function payment(order, overrides = {}) {
  return source.getRepository(Payment).create({
    createdAt: new Date(Date.now() - 5000),
    orderId: order.id,
    providerReference: randomUUID(),
    amountVnd: order.totalVnd,
    paymentUrl: 'https://sandbox.invalid/unsigned-fixture',
    expiresAt: new Date(Date.now() + 1200000),
    ...overrides,
  });
}

async function violation(action, code, constraint) {
  const expected = { code };
  if (constraint) expected.constraint = constraint;
  await expect(action()).rejects.toMatchObject({ driverError: expected });
}

test('migration down/up recreates an empty schema and repeat up is a no-op', async () => {
  await source.undoLastMigration();
  expect(
    await source.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('typeorm_migrations', 'typeorm_metadata')",
    ),
  ).toHaveLength(0);
  await expect(startBuiltApplication(appDatabase())).rejects.toThrow(
    'exited before readiness',
  );
  // A nonempty unknown schema must not be adopted by the initial migration.
  await source.query('CREATE TABLE migration_guard (id integer)');
  await expect(source.runMigrations()).rejects.toThrow(
    'requires an empty public schema',
  );
  expect(
    await source.query("SELECT to_regclass('public.migration_guard') AS name"),
  ).toEqual([{ name: 'migration_guard' }]);
  await source.query('DROP TABLE migration_guard');
  expect(await source.runMigrations()).toHaveLength(1);
  expect(await source.runMigrations()).toHaveLength(0);
});

test('M1 compiled application starts on migrated PostgreSQL with health, Swagger and safe errors', async () => {
  const application = await startBuiltApplication(appDatabase());
  try {
    const id = randomUUID();
    const response = await fetch(application.base + '/api/v1/health', {
      headers: { 'X-Correlation-ID': id },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-correlation-id')).toBe(id);
    expect(await response.json()).toEqual({
      success: true,
      data: { status: 'ok' },
      meta: { correlationId: id },
    });
    const spec = await (
      await fetch(application.base + '/api/docs-json')
    ).json();
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/health',
        '/api/v1/auth/register',
        '/api/v1/auth/login',
        '/api/v1/auth/refresh',
      ]),
    );
    for (const path of [
      '/',
      '/api/v1/auth/login',
      '/api/v1/payments/vnpay/ipn',
    ]) {
      const missing = await fetch(application.base + path);
      expect(missing.status).toBe(404);
      expect((await missing.json()).error.code).toBe('NOT_FOUND');
    }
    expect(
      application.output().includes(application.env.JWT_ACCESS_SECRET),
    ).toBe(false);
    expect(application.output().includes(application.env.DB_PASSWORD)).toBe(
      false,
    );
    expect(
      application
        .output()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .some((record) => record.event === 'startup.ready'),
    ).toBe(true);
  } finally {
    await application.close();
  }
});

test('all ten entities match live columns; checks, FKs and six partial indexes exist', async () => {
  expect(entities).toHaveLength(10);
  const columns = await source.query(
    "SELECT table_name, column_name, is_nullable, data_type, character_maximum_length, is_generated FROM information_schema.columns WHERE table_schema='public' AND table_name NOT IN ('typeorm_migrations', 'typeorm_metadata')",
  );
  expect(columns).toHaveLength(97);
  for (const entity of entities) {
    const metadata = source.getMetadata(entity);
    const tableColumns = columns.filter(
      (column) => column.table_name === metadata.tableName,
    );
    expect(tableColumns).toHaveLength(metadata.columns.length);
    for (const column of metadata.columns) {
      const live = tableColumns.find(
        (item) => item.column_name === column.databaseName,
      );
      expect(live).toBeDefined();
      expect(live.is_nullable === 'YES').toBe(column.isNullable);
      const type =
        {
          varchar: 'character varying',
          timestamptz: 'timestamp with time zone',
        }[column.type] ?? column.type;
      expect(live.data_type).toBe(type);
      if (column.length)
        expect(live.character_maximum_length).toBe(Number(column.length));
    }
    expect(metadata.primaryColumns[0].isGenerated).toBe(false);
  }
  const checks = await source.query(
    "SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND contype='c'",
  );
  expect(checks).toHaveLength(32);
  const fks = await source.query(
    "SELECT confdeltype, confupdtype FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND contype='f'",
  );
  expect(fks).toHaveLength(12);
  expect(
    fks.every((fk) => fk.confdeltype === 'r' && fk.confupdtype === 'r'),
  ).toBe(true);
  const partial = await source.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexdef LIKE '% WHERE %'",
  );
  expect(partial.map((index) => index.indexname).sort()).toEqual(
    [
      'refresh_one_live_token_idx',
      'order_due_idx',
      'history_one_initial_idx',
      'payment_one_pending_idx',
      'payment_one_success_idx',
      'payment_due_idx',
    ].sort(),
  );
});

test('bigint stays exact and generated line total is never written by ORM insert/save', async () => {
  const { user, product, order } = await fixture();
  const repository = source.getRepository(OrderItem);
  const line = repository.create({
    orderId: order.id,
    productId: product.id,
    productName: product.name,
    unitPriceVnd: product.priceVnd,
    quantity: 2,
    lineTotalVnd: '1',
  });
  await repository.save(line);
  const saved = await repository.findOneByOrFail({ id: line.id });
  expect(saved.lineTotalVnd).toBe('18014398509481986');
  expect(JSON.parse(JSON.stringify(saved)).lineTotalVnd).toBe(
    '18014398509481986',
  );
  saved.quantity = 3;
  saved.lineTotalVnd = '2';
  await repository.save(saved);
  expect((await repository.findOneByOrFail({ id: line.id })).lineTotalVnd).toBe(
    '27021597764222979',
  );
  await violation(
    () =>
      source.query('UPDATE order_items SET line_total_vnd=1 WHERE id=$1', [
        line.id,
      ]),
    '428C9',
  );
  const column = source
    .getMetadata(OrderItem)
    .findColumnWithPropertyName('lineTotalVnd');
  expect(column.isInsert).toBe(false);
  expect(column.isUpdate).toBe(false);
  expect(
    (await source.getRepository(User).findOneByOrFail({ id: user.id }))
      .passwordHash,
  ).toBeUndefined();
});

test('UUIDs come from application code and database primary keys have no generation default', async () => {
  expect(new User().id).toMatch(/^[0-9a-f-]{36}$/);
  const columns = await source.query(
    "SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND column_name='id' AND table_name NOT IN ('typeorm_migrations', 'typeorm_metadata')",
  );
  expect(columns).toHaveLength(10);
  expect(columns.every((column) => column.column_default === null)).toBe(true);
  await violation(
    () =>
      source.query(
        "INSERT INTO products(name,price_vnd,stock_available) VALUES ('Missing ID',1,0)",
      ),
    '23502',
  );
});

test('refresh one-live-family allows consumed history but prevents a second live successor', async () => {
  const { user } = await fixture();
  const repository = source.getRepository(RefreshToken);
  const original = await repository.save(token(user));
  await violation(
    () => repository.save(token(user, { familyId: original.familyId })),
    '23505',
    'refresh_one_live_token_idx',
  );
  await source.transaction(async (manager) => {
    await manager.update(RefreshToken, original.id, { consumedAt: new Date() });
    await manager.save(token(user, { familyId: original.familyId }));
  });
  expect(await repository.countBy({ familyId: original.familyId })).toBe(2);
  await violation(
    () => repository.save(token(user, { tokenHash: 'not-a-sha256-hash' })),
    '23514',
    'refresh_hash_format',
  );
  await violation(
    () => repository.save(token(user, { status: 'REVOKED' })),
    '23514',
    'refresh_revocation_valid',
  );
  await violation(
    () => repository.save(token(user, { expiresAt: new Date(0) })),
    '23514',
    'refresh_expiry_valid',
  );
});

test('payments enforce independent one-pending and one-success constraints, with failed history allowed', async () => {
  const { order } = await fixture();
  const repository = source.getRepository(Payment);
  const pending = await repository.save(payment(order));
  await violation(
    () => repository.save(payment(order)),
    '23505',
    'payment_one_pending_idx',
  );
  await repository.update(pending.id, {
    status: 'FAILED',
    terminalAt: new Date(),
  });
  await repository.save(payment(order));
  await repository.save(
    payment(order, { status: 'SUCCESS', terminalAt: new Date() }),
  );
  await violation(
    () =>
      repository.save(
        payment(order, { status: 'SUCCESS', terminalAt: new Date() }),
      ),
    '23505',
    'payment_one_success_idx',
  );
  await violation(
    () =>
      repository.save(
        payment(order, {
          providerReference: pending.providerReference,
          status: 'FAILED',
          terminalAt: new Date(),
        }),
      ),
    '23505',
    'payments_provider_reference_key',
  );
  await violation(
    () =>
      repository.save(payment(order, { status: 'FAILED', terminalAt: null })),
    '23514',
    'payment_terminal_valid',
  );
  expect(
    (await repository.findOneByOrFail({ id: pending.id })).paymentUrl,
  ).toBeUndefined();
});

test.each([
  [
    'product_stock_nonnegative',
    'UPDATE products SET stock_available=-1 WHERE id=$1',
  ],
  ['product_price_positive', 'UPDATE products SET price_vnd=0 WHERE id=$1'],
  ['product_name_present', "UPDATE products SET name=' ' WHERE id=$1"],
  [
    'product_image_relative',
    "UPDATE products SET image_path='../escape.png' WHERE id=$1",
  ],
])('%s is enforced by PostgreSQL', async (constraint, sql) => {
  const { product } = await fixture();
  await violation(() => source.query(sql, [product.id]), '23514', constraint);
});

test('integer, bigint and generated multiplication overflow are rejected', async () => {
  const { product, order } = await fixture();
  await violation(
    () =>
      source.query(
        'UPDATE products SET stock_available=2147483648 WHERE id=$1',
        [product.id],
      ),
    '22003',
  );
  await violation(
    () =>
      source.query(
        "UPDATE products SET price_vnd='9223372036854775808' WHERE id=$1",
        [product.id],
      ),
    '22003',
  );
  await violation(
    () =>
      source.getRepository(OrderItem).save(
        source.getRepository(OrderItem).create({
          orderId: order.id,
          productId: product.id,
          productName: product.name,
          unitPriceVnd: '9223372036854775807',
          quantity: 2,
        }),
      ),
    '22003',
  );
});

test('FK delete/update retention, orphan prevention and unique order/product are enforced', async () => {
  const { user, product, order } = await fixture();
  const repository = source.getRepository(OrderItem);
  await repository.save(
    repository.create({
      orderId: order.id,
      productId: product.id,
      productName: product.name,
      unitPriceVnd: '1',
      quantity: 1,
    }),
  );
  await violation(
    () =>
      repository.save(
        repository.create({
          orderId: order.id,
          productId: product.id,
          productName: product.name,
          unitPriceVnd: '1',
          quantity: 1,
        }),
      ),
    '23505',
    'order_item_product_unique',
  );
  await violation(
    () => source.query('DELETE FROM users WHERE id=$1', [user.id]),
    '23001',
  );
  await violation(
    () =>
      source.query('UPDATE products SET id=$2 WHERE id=$1', [
        product.id,
        randomUUID(),
      ]),
    '23001',
  );
  await violation(
    () =>
      repository.save(
        repository.create({
          orderId: order.id,
          productId: randomUUID(),
          productName: 'Orphan',
          unitPriceVnd: '1',
          quantity: 1,
        }),
      ),
    '23503',
  );
});

test('users enforce email normalization, uniqueness, role and nonempty hash', async () => {
  const { user } = await fixture();
  await violation(
    () =>
      source.query("UPDATE users SET email='UPPER@TEST.INVALID' WHERE id=$1", [
        user.id,
      ]),
    '23514',
    'users_email_normalized',
  );
  await violation(
    () => source.query("UPDATE users SET role='ROOT' WHERE id=$1", [user.id]),
    '23514',
    'users_role_valid',
  );
  await violation(
    () =>
      source.query("UPDATE users SET password_hash=' ' WHERE id=$1", [user.id]),
    '23514',
    'users_password_hash_present',
  );
  await violation(
    () =>
      source
        .getRepository(User)
        .save(
          source
            .getRepository(User)
            .create({ email: user.email, passwordHash: 'fixture' }),
        ),
    '23505',
    'users_email_key',
  );
});

test('shipping/deadline, role/inventory audits, history and safe receipt constraints hold', async () => {
  const { user, product, order } = await fixture();
  await violation(
    () =>
      source.query("UPDATE orders SET address_line=' ' WHERE id=$1", [
        order.id,
      ]),
    '23514',
    'order_shipping_present',
  );
  await violation(
    () =>
      source.query(
        'UPDATE orders SET reservation_expires_at=created_at WHERE id=$1',
        [order.id],
      ),
    '23514',
    'order_expiry_valid',
  );
  const roleRepo = source.getRepository(RoleChangeAudit);
  await violation(
    () =>
      roleRepo.save(
        roleRepo.create({
          actorUserId: user.id,
          affectedUserId: user.id,
          oldRole: 'CUSTOMER',
          newRole: 'CUSTOMER',
        }),
      ),
    '23514',
    'role_audit_values',
  );
  const auditRepo = source.getRepository(InventoryAdjustmentAudit);
  await violation(
    () =>
      auditRepo.save(
        auditRepo.create({
          actorUserId: user.id,
          productId: product.id,
          previousStock: 10,
          quantityDelta: 2,
          newStock: 13,
          reason: 'Test',
        }),
      ),
    '23514',
    'inventory_audit_quantities',
  );
  await violation(
    () =>
      auditRepo.save(
        auditRepo.create({
          actorUserId: user.id,
          productId: product.id,
          previousStock: 10,
          quantityDelta: 2,
          newStock: 12,
          reason: ' ',
        }),
      ),
    '23514',
    'inventory_audit_reason',
  );
  const historyRepo = source.getRepository(OrderStatusHistory);
  await historyRepo.save(
    historyRepo.create({
      orderId: order.id,
      previousStatus: null,
      newStatus: 'PENDING_PAYMENT',
    }),
  );
  await violation(
    () =>
      historyRepo.save(
        historyRepo.create({
          orderId: order.id,
          previousStatus: null,
          newStatus: 'PENDING_PAYMENT',
        }),
      ),
    '23505',
    'history_one_initial_idx',
  );
  await violation(
    () =>
      historyRepo.save(
        historyRepo.create({
          orderId: order.id,
          previousStatus: 'PAID',
          newStatus: 'COMPLETED',
          actorUserId: user.id,
        }),
      ),
    '23514',
    'history_transition_valid',
  );
  await violation(
    () =>
      historyRepo.save(
        historyRepo.create({
          orderId: order.id,
          previousStatus: 'PAID',
          newStatus: 'PROCESSING',
        }),
      ),
    '23514',
    'history_human_actor',
  );
  const receipts = source.getRepository(PaymentNotification);
  await receipts.save(
    receipts.create({
      correlationId: randomUUID(),
      signatureVerified: false,
      outcome: 'UNKNOWN_REFERENCE',
    }),
  );
  await violation(
    () =>
      receipts.save(
        receipts.create({
          correlationId: randomUUID(),
          signatureVerified: false,
          outcome: 'SETTLED',
        }),
      ),
    '23514',
    'notification_verified_effect',
  );
});

test('transaction rollback preserves stock and removes all partial inserts', async () => {
  const { product } = await fixture();
  const id = randomUUID();
  await expect(
    source.transaction(async (manager) => {
      await manager.update(Product, product.id, { stockAvailable: 0 });
      await manager.insert(User, {
        id,
        email: `${id}@test.invalid`,
        passwordHash: 'fixture',
      });
      throw new Error('Controlled rollback');
    }),
  ).rejects.toThrow('Controlled rollback');
  expect(
    (await source.getRepository(Product).findOneByOrFail({ id: product.id }))
      .stockAvailable,
  ).toBe(10);
  expect(await source.getRepository(User).findOneBy({ id })).toBeNull();
});

test('development seed is repeatable and preserves edited records and existing accounts', async () => {
  await seedDevelopment(source, 'test');
  const repository = source.getRepository(Product);
  const firstId = developmentProducts[0].id;
  await repository.update(firstId, {
    name: 'Retained edit',
    stockAvailable: 0,
    priceVnd: '99000',
    imagePath: 'products/retained.png',
  });
  await seedDevelopment(source, 'test');
  await seedDevelopment(source, 'test');
  expect(await repository.findOneByOrFail({ id: firstId })).toMatchObject({
    name: 'Retained edit',
    stockAvailable: 0,
    priceVnd: '99000',
    imagePath: 'products/retained.png',
  });
  for (const product of developmentProducts)
    expect(await repository.countBy({ id: product.id })).toBe(1);
  await expect(seedDevelopment(source, 'production')).rejects.toThrow(
    'forbidden',
  );
});

test('initial admin hashes external credentials, is repeatable and never promotes an existing customer', async () => {
  const password = randomBytes(24).toString('hex');
  const input = adminInput({
    INITIAL_ADMIN_EMAIL: `${randomUUID()}@TEST.INVALID`,
    INITIAL_ADMIN_PASSWORD: password,
  });
  expect(await setupInitialAdmin(source, input)).toBe('created');
  const repository = source.getRepository(User);
  const saved = await repository
    .createQueryBuilder('u')
    .addSelect('u.passwordHash')
    .where('u.email=:email', { email: input.email })
    .getOneOrFail();
  expect(saved.role).toBe('ADMIN');
  expect(saved.passwordHash).not.toContain(password);
  const [, n, r, p, salt, hash] = saved.passwordHash.split('$');
  expect(Number(n)).toBeGreaterThanOrEqual(131072);
  expect(
    scryptSync(password, salt, 64, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * 1024 * 1024,
    }).toString('hex'),
  ).toBe(hash);
  expect(
    await setupInitialAdmin(source, {
      ...input,
      password: randomBytes(24).toString('hex'),
    }),
  ).toBe('existing');
  const unchanged = await repository
    .createQueryBuilder('u')
    .addSelect('u.passwordHash')
    .where('u.id=:id', { id: saved.id })
    .getOneOrFail();
  expect(unchanged.passwordHash).toBe(saved.passwordHash);
  expect(unchanged.role).toBe('ADMIN');
  const { user } = await fixture();
  await expect(
    setupInitialAdmin(source, { ...input, email: user.email }),
  ).rejects.toThrow('non-admin');
  expect((await repository.findOneByOrFail({ id: user.id })).role).toBe(
    'CUSTOMER',
  );
});

describe('Day 4 auth API on real PostgreSQL', () => {
  let application;
  const { createHash } = require('node:crypto');
  const { setTimeout: delay } = require('node:timers/promises');
  const {
    hashPassword,
    verifyPassword,
  } = require('../dist/modules/auth/password');
  const hash = (token) => createHash('sha256').update(token).digest('hex');
  beforeAll(async () => {
    application = await startBuiltApplication(appDatabase(), {
      accessTtlSeconds: 47,
      refreshTtlSeconds: 430,
    });
  });
  afterAll(async () => {
    await application?.close();
  });

  async function post(route, body) {
    const response = await fetch(application.base + '/api/v1/auth/' + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: await response.json(),
      cache: response.headers.get('cache-control'),
    };
  }
  async function account() {
    const credentials = {
      email: `${randomUUID()}@test.invalid`,
      password: randomBytes(24).toString('hex'),
    };
    const registered = await post('register', credentials);
    expect(registered.status).toBe(201);
    return { credentials, user: registered.body.data };
  }
  async function session() {
    const fixture = await account();
    const login = await post('login', fixture.credentials);
    expect(login.status).toBe(200);
    return { ...fixture, pair: login.body.data };
  }
  async function rows(userId) {
    return source.query(
      'SELECT * FROM refresh_tokens WHERE user_id=$1 ORDER BY created_at,id',
      [userId],
    );
  }
  async function waitForBlocked(count, queryFragment) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const result = await source.query(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1",
        [`%${queryFragment}%`],
      );
      if (result[0].count >= count) return;
      await delay(15);
    }
    throw new Error(
      'Expected independent PostgreSQL lock waiters were not observed',
    );
  }
  async function userBlock(userId) {
    const blocker = source.createQueryRunner();
    await blocker.connect();
    await blocker.startTransaction();
    await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [
      userId,
    ]);
    return blocker;
  }

  test('duplicate normalized registration race: exactly one CUSTOMER, salted hash only, no session', async () => {
    const email = `${randomUUID()}@test.invalid`;
    const password = randomBytes(24).toString('hex');
    const blocker = source.createQueryRunner();
    await blocker.connect();
    await blocker.startTransaction();
    await blocker.query('LOCK TABLE users IN SHARE MODE');
    const pending = [
      post('register', { email: ` ${email.toUpperCase()} `, password }),
      post('register', { email, password }),
    ];
    try {
      await waitForBlocked(2, 'INSERT INTO');
      await blocker.commitTransaction();
      const results = await Promise.all(pending);
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      const created = results.find((result) => result.status === 201).body.data;
      expect(Object.keys(created).sort()).toEqual(
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
      expect(created).toMatchObject({
        email,
        role: 'CUSTOMER',
        isActive: true,
      });
      const users = await source.query('SELECT * FROM users WHERE email=$1', [
        email,
      ]);
      expect(users).toHaveLength(1);
      expect(await verifyPassword(password, users[0].password_hash)).toBe(true);
      expect(await rows(created.id)).toHaveLength(0);
      expect(
        results.find((result) => result.status === 409).body.error.code,
      ).toBe('EMAIL_IN_USE');
    } finally {
      if (blocker.isTransactionActive) await blocker.rollbackTransaction();
      await blocker.release();
      await Promise.allSettled(pending);
    }
  });

  test('active login issues env-configured JWT/opaque token and stores hash/lifecycle only; generic invalid credentials', async () => {
    const { credentials, user, pair } = await session();
    const { jwtVerify } = await import('jose');
    const verified = await jwtVerify(
      pair.accessToken,
      new TextEncoder().encode(application.env.JWT_ACCESS_SECRET),
      {
        algorithms: ['HS256'],
        issuer: 'nestshop-api',
        audience: 'nestshop-clients',
      },
    );
    expect(verified.payload).toMatchObject({
      sub: user.id,
      role: 'CUSTOMER',
      tokenType: 'access',
    });
    expect(verified.payload.exp - verified.payload.iat).toBe(pair.expiresIn);
    expect(pair.expiresIn).toBe(47);
    expect(Buffer.from(pair.refreshToken, 'base64url')).toHaveLength(32);
    const stored = await rows(user.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      token_hash: hash(pair.refreshToken),
      status: 'ACTIVE',
      consumed_at: null,
      revoked_at: null,
      revocation_reason: null,
    });
    expect(
      new Date(stored[0].expires_at) - new Date(stored[0].created_at),
    ).toBe(430000);
    expect(Object.keys(pair.user)).not.toContain('passwordHash');
    expect(JSON.stringify(pair)).not.toContain(stored[0].token_hash);
    const unknown = await post('login', {
      ...credentials,
      email: `${randomUUID()}@test.invalid`,
    });
    const wrong = await post('login', {
      ...credentials,
      password: randomBytes(24).toString('hex'),
    });
    await source.query('UPDATE users SET is_active=false WHERE id=$1', [
      user.id,
    ]);
    const inactive = await post('login', credentials);
    for (const result of [unknown, wrong, inactive]) {
      expect(result.status).toBe(401);
      expect(result.body.error).toEqual({
        status: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }
    expect(await rows(user.id)).toHaveLength(1);
    expect(
      (await post('refresh', { refreshToken: pair.refreshToken })).status,
    ).toBe(401);
    expect((await rows(user.id))[0].consumed_at).toBeNull();
    expect(application.output()).not.toContain(credentials.password);
    expect(application.output()).not.toContain(pair.refreshToken);
    expect(application.output()).not.toContain(pair.accessToken);
  });

  test.each(['password', 'inactive'])(
    'login rechecks %s after waiting for user lock and inserts no family',
    async (change) => {
      const { credentials, user } = await account();
      const replacement = await hashPassword(randomBytes(24).toString('hex'));
      const blocker = await userBlock(user.id);
      const pending = post('login', credentials);
      try {
        await waitForBlocked(1, 'FOR UPDATE');
        if (change === 'password')
          await blocker.query('UPDATE users SET password_hash=$1 WHERE id=$2', [
            replacement,
            user.id,
          ]);
        else
          await blocker.query('UPDATE users SET is_active=false WHERE id=$1', [
            user.id,
          ]);
        await blocker.commitTransaction();
        expect((await pending).status).toBe(401);
        expect(await rows(user.id)).toHaveLength(0);
      } finally {
        if (blocker.isTransactionActive) await blocker.rollbackTransaction();
        await blocker.release();
        await Promise.allSettled([pending]);
      }
    },
  );

  test('normal rotation consumes old before successor; current role, new token, same family and committed replay revokes successors only in that family', async () => {
    const { credentials, user, pair } = await session();
    const other = (await post('login', credentials)).body.data;
    await source.query("UPDATE users SET role='STAFF' WHERE id=$1", [user.id]);
    const rotated = await post('refresh', { refreshToken: pair.refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.cache).toBe('no-store');
    const successor = rotated.body.data;
    expect(successor.user.role).toBe('STAFF');
    expect(hash(successor.refreshToken)).not.toBe(hash(pair.refreshToken));
    const before = await rows(user.id);
    const old = before.find(
      (row) => row.token_hash === hash(pair.refreshToken),
    );
    const next = before.find(
      (row) => row.token_hash === hash(successor.refreshToken),
    );
    expect(old.consumed_at).not.toBeNull();
    expect(next.family_id).toBe(old.family_id);
    expect(next.consumed_at).toBeNull();
    expect(next.status).toBe('ACTIVE');
    // Expiry must not erase evidence that an earlier credential was consumed.
    await source.query(
      "UPDATE refresh_tokens SET expires_at=created_at+interval '1 microsecond' WHERE id=$1",
      [old.id],
    );
    const replay = await post('refresh', { refreshToken: pair.refreshToken });
    expect(replay.body.error.code).toBe('REFRESH_REPLAY');
    const after = await rows(user.id);
    const family = after.filter((row) => row.family_id === old.family_id);
    expect(family).toHaveLength(2);
    for (const row of family) {
      expect(row.status).toBe('REVOKED');
      expect(row.revocation_reason).toBe('REPLAY');
      expect(row.revoked_at).not.toBeNull();
    }
    expect(
      after.find((row) => row.token_hash === hash(other.refreshToken)).status,
    ).toBe('ACTIVE');
    expect(
      (await post('refresh', { refreshToken: successor.refreshToken })).body
        .error.code,
    ).toBe('INVALID_REFRESH_TOKEN');
    expect(
      (await rows(user.id)).filter((row) => row.family_id === old.family_id),
    ).toHaveLength(2);
  });

  test('concurrent rotation has one winner; loser replay commits revocation of winning successor (no grace period)', async () => {
    const { user, pair } = await session();
    const blocker = await userBlock(user.id);
    const pending = [
      post('refresh', { refreshToken: pair.refreshToken }),
      post('refresh', { refreshToken: pair.refreshToken }),
    ];
    try {
      await waitForBlocked(2, 'FOR UPDATE');
      await blocker.commitTransaction();
      const results = await Promise.all(pending);
      expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
      expect(
        results.find((result) => result.status === 401).body.error.code,
      ).toBe('REFRESH_REPLAY');
      const family = await rows(user.id);
      expect(family).toHaveLength(2);
      expect(family.filter((row) => row.consumed_at !== null)).toHaveLength(1);
      expect(
        family.every(
          (row) =>
            row.status === 'REVOKED' &&
            row.revocation_reason === 'REPLAY' &&
            row.revoked_at !== null,
        ),
      ).toBe(true);
      const winner = results.find((result) => result.status === 200).body.data;
      expect(
        (await post('refresh', { refreshToken: winner.refreshToken })).status,
      ).toBe(401);
    } finally {
      if (blocker.isTransactionActive) await blocker.rollbackTransaction();
      await blocker.release();
      await Promise.allSettled(pending);
    }
  });

  test.each(['LOGOUT', 'PASSWORD_CHANGE'])(
    'ordinary %s revocation of consumed token is never reclassified as replay',
    async (reason) => {
      const { user, pair } = await session();
      const rotated = await post('refresh', {
        refreshToken: pair.refreshToken,
      });
      expect(rotated.status).toBe(200);
      await source.transaction(async (manager) => {
        await manager.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [
          user.id,
        ]);
        await manager.query(
          "UPDATE refresh_tokens SET status='REVOKED', revoked_at=clock_timestamp(), revocation_reason=$2 WHERE user_id=$1",
          [user.id, reason],
        );
      });
      const before = await rows(user.id);
      for (const token of [pair.refreshToken, rotated.body.data.refreshToken]) {
        expect(
          (await post('refresh', { refreshToken: token })).body.error.code,
        ).toBe('INVALID_REFRESH_TOKEN');
      }
      const after = await rows(user.id);
      expect(after).toEqual(before);
    },
  );

  test('expiry is rechecked with wall clock after user lock; wrong token type/unknown reject without mutation', async () => {
    const { user, pair } = await session();
    const blocker = await userBlock(user.id);
    const pending = post('refresh', { refreshToken: pair.refreshToken });
    try {
      await waitForBlocked(1, 'FOR UPDATE');
      await blocker.query(
        "UPDATE refresh_tokens SET created_at=clock_timestamp()-interval '2 days', expires_at=clock_timestamp() WHERE user_id=$1",
        [user.id],
      );
      await blocker.commitTransaction();
      expect((await pending).body.error.code).toBe('INVALID_REFRESH_TOKEN');
    } finally {
      if (blocker.isTransactionActive) await blocker.rollbackTransaction();
      await blocker.release();
      await Promise.allSettled([pending]);
    }
    expect(
      (await post('refresh', { refreshToken: pair.accessToken })).status,
    ).toBe(400);
    expect(
      (
        await post('refresh', {
          refreshToken: randomBytes(32).toString('base64url'),
        })
      ).body.error.code,
    ).toBe('INVALID_REFRESH_TOKEN');
    const family = await rows(user.id);
    expect(family).toHaveLength(1);
    expect(family[0].consumed_at).toBeNull();
  });

  test('successor signing failure rolls consumption back on real PostgreSQL', async () => {
    const { user, pair } = await session();
    const { AuthService } = require('../dist/modules/auth/auth.service');
    const { ConfigService } = require('@nestjs/config');
    const service = new AuthService(
      source,
      new ConfigService({
        jwt: { accessTtlSeconds: 900, refreshTtlSeconds: 604800 },
      }),
      {
        sign: async () => {
          throw new Error('Controlled signing failure');
        },
      },
    );
    await expect(service.refresh(pair.refreshToken)).rejects.toThrow(
      'Controlled signing failure',
    );
    const family = await rows(user.id);
    expect(family).toHaveLength(1);
    expect(family[0].consumed_at).toBeNull();
    expect(family[0].status).toBe('ACTIVE');
    expect(
      (await post('refresh', { refreshToken: pair.refreshToken })).status,
    ).toBe(200);
  });
});

registerAccountCases(() => source, appDatabase);
registerProductCases(() => source, appDatabase);
