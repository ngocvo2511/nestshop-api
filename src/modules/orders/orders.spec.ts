import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  configureHttp,
  initializeHttp,
} from '../../common/http/configure-http';
import { SafeJsonLogger } from '../../common/logging/safe-json.logger';
import { configureOpenApi } from '../../openapi';
import { AccessTokenService } from '../auth/access-token.service';
import { Product } from '../products/entities/product.entity';
import { calculateCheckout } from './checkout-calculation';
import { OrdersModule } from './orders.module';
import { OrdersService } from './orders.service';

describe('checkout exact calculation', () => {
  const first = randomUUID();
  const second = randomUUID();
  const product = (
    id: string,
    priceVnd: string,
    stockAvailable = 10,
    isActive = true,
  ) =>
    Object.assign(new Product(), {
      id,
      name: 'Snapshot',
      priceVnd,
      stockAvailable,
      isActive,
    });
  it('computes exact lines and sum beyond Number precision', () => {
    const result = calculateCheckout(
      [
        { productId: first, quantity: 3 },
        { productId: second, quantity: 2 },
      ],
      [product(first, '9007199254740993'), product(second, '2')],
    );
    expect(result.totalVnd).toBe('27021597764222983');
    expect(result.lines.map((line) => line.lineTotalVnd)).toEqual([
      '27021597764222979',
      '4',
    ]);
  });
  it('accepts the exact bigint maximum', () => {
    expect(
      calculateCheckout(
        [{ productId: first, quantity: 1 }],
        [product(first, '9223372036854775807')],
      ).totalVnd,
    ).toBe('9223372036854775807');
  });
  it('rejects both multiplication and accumulated-sum overflow', () => {
    expect(() =>
      calculateCheckout(
        [{ productId: first, quantity: 2 }],
        [product(first, '9223372036854775807')],
      ),
    ).toThrow('Amount exceeds the supported limit');
    expect(() =>
      calculateCheckout(
        [
          { productId: first, quantity: 1 },
          { productId: second, quantity: 1 },
        ],
        [product(first, '9223372036854775807'), product(second, '1')],
      ),
    ).toThrow('Amount exceeds the supported limit');
  });
  it.each(['missing', 'inactive', 'insufficient'])(
    'rejects %s locked product state',
    (kind) => {
      const products =
        kind === 'missing'
          ? []
          : [
              product(
                first,
                '1',
                kind === 'insufficient' ? 0 : 10,
                kind !== 'inactive',
              ),
            ];
      expect(() =>
        calculateCheckout([{ productId: first, quantity: 1 }], products),
      ).toThrow('Requested stock is unavailable');
    },
  );
});

describe('checkout HTTP boundary and ownership', () => {
  let app: INestApplication;
  let base: string;
  let tokens: AccessTokenService;
  const customerId = randomUUID();
  const productId = randomUUID();
  const shipping = {
    recipientName: 'Customer',
    recipientPhone: '+84901234567',
    addressLine: 'Address 1',
    provinceCity: 'City',
  };
  const valid = { items: [{ productId, quantity: 1 }], shipping };
  const checkout = jest
    .fn()
    .mockResolvedValue({ id: randomUUID(), status: 'PENDING_PAYMENT' });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [OrdersModule] })
      .overrideProvider(OrdersService)
      .useValue({ checkout })
      .useMocker((token) =>
        token === DataSource
          ? {}
          : token === ConfigService
            ? new ConfigService({
                jwt: {
                  accessSecret: randomBytes(32).toString('hex'),
                  issuer: 'checkout',
                  audience: 'checkout',
                  accessTtlSeconds: 900,
                },
              })
            : undefined,
      )
      .compile();
    const logger = new SafeJsonLogger(() => undefined);
    app = module.createNestApplication({ logger, bodyParser: false });
    configureHttp(app, logger);
    configureOpenApi(app);
    await initializeHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    tokens = app.get(AccessTokenService);
  });
  afterAll(async () => {
    await app?.close();
  });
  async function post(
    body: unknown,
    role: string | null = 'CUSTOMER',
    query = '',
  ) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-User-Id': randomUUID(),
    };
    if (role)
      headers.Authorization =
        'Bearer ' + (await tokens.sign({ id: customerId, role }, new Date()));
    return fetch(base + '/api/v1/orders' + query, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }
  it.each([null, 'CUSTOMER', 'STAFF', 'ADMIN'])(
    'CUSTOMER-only permission for %s',
    async (role) => {
      expect((await post(valid, role)).status).toBe(
        role === 'CUSTOMER' ? 201 : role ? 403 : 401,
      );
      if (role === 'CUSTOMER')
        expect(checkout).toHaveBeenLastCalledWith(
          customerId,
          expect.objectContaining(valid),
        );
      else expect(checkout).not.toHaveBeenCalled();
    },
  );
  it.each([
    {},
    { ...valid, items: [] },
    { ...valid, items: null },
    { ...valid, items: {} },
    { ...valid, items: [null] },
    { ...valid, items: [1] },
    { ...valid, items: [[{ productId, quantity: 1 }]] },
    { ...valid, items: [{ productId, quantity: 0 }] },
    { ...valid, items: [{ productId, quantity: -1 }] },
    { ...valid, items: [{ productId, quantity: 1.5 }] },
    { ...valid, items: [{ productId, quantity: '1' }] },
    { ...valid, items: [{ productId, quantity: 2147483648 }] },
    { ...valid, items: [{ productId: 'bad', quantity: 1 }] },
    {
      ...valid,
      items: [
        { productId, quantity: 1 },
        { productId: productId.toUpperCase(), quantity: 1 },
      ],
    },
    {
      ...valid,
      items: Array.from({ length: 101 }, () => ({
        productId: randomUUID(),
        quantity: 1,
      })),
    },
    { ...valid, shipping: null },
    { items: valid.items },
    { ...valid, shipping: [shipping] },
    { ...valid, shipping: {} },
    { ...valid, shipping: { ...shipping, recipientPhone: 84901234567 } },
    { ...valid, shipping: { ...shipping, recipientName: '' } },
    { ...valid, shipping: { ...shipping, addressLine: ' ' } },
    { ...valid, shipping: { ...shipping, provinceCity: '' } },
    { ...valid, totalVnd: '1' },
    { ...valid, userId: randomUUID() },
    { ...valid, addressId: randomUUID() },
    { ...valid, cartId: randomUUID() },
    { ...valid, status: 'PAID' },
    { ...valid, items: [{ productId, quantity: 1, unitPriceVnd: '1' }] },
    { ...valid, shipping: { ...shipping, userId: randomUUID() } },
  ])('rejects invalid/nested/protected checkout input', async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(checkout).not.toHaveBeenCalled();
  });
  it('accepts 100 distinct products and integer quantity maximum without coercion', async () => {
    const items = Array.from({ length: 100 }, () => ({
      productId: randomUUID(),
      quantity: 2147483647,
    }));
    expect((await post({ items, shipping })).status).toBe(201);
    expect(checkout).toHaveBeenLastCalledWith(
      customerId,
      expect.objectContaining({ items }),
    );
  });
  it('rejects unknown query transport and publishes only checkout for orders', async () => {
    expect(
      (await post(valid, 'CUSTOMER', '?userId=' + randomUUID())).status,
    ).toBe(400);
    const spec = (await (await fetch(base + '/api/docs-json')).json()) as {
      paths: Record<string, Record<string, { security?: unknown }>>;
    };
    expect(spec.paths['/api/v1/orders'].post.security).toEqual([
      { bearer: [] },
    ]);
    expect(spec.paths['/api/v1/orders'].get).toBeUndefined();
    expect(spec.paths['/api/v1/orders/{id}/payment-attempts']).toBeUndefined();
  });
});
