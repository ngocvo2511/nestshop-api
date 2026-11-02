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
import { ProductsModule } from './products.module';
import { ProductsService, publicProduct } from './products.service';
import { ProductQueryDto } from './products.dto';
import { Product } from './entities/product.entity';

describe('catalog service boundaries', () => {
  const service = new ProductsService(null);
  it('rejects inverted exact bigint bounds before querying', async () => {
    await expect(
      service.list(
        Object.assign(new ProductQueryDto(), {
          minPriceVnd: '9007199254740993',
          maxPriceVnd: '9007199254740992',
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('rejects empty patch before persistence', async () => {
    await expect(service.update(randomUUID(), {})).rejects.toMatchObject({
      code: 'EMPTY_UPDATE',
    });
  });
  it('serializes exact VND strings and only a public image reference', () => {
    const id = randomUUID();
    const result = publicProduct(
      Object.assign(new Product(), {
        id,
        name: 'Example',
        description: null,
        priceVnd: '9223372036854775807',
        stockAvailable: 0,
        isActive: true,
        imagePath: 'products/private-reference.png',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    expect(result.priceVnd).toBe('9223372036854775807');
    expect(result.imageUrl).toBe(`/api/v1/products/${id}/image`);
    expect(Object.keys(result)).not.toContain('imagePath');
  });
});

describe('catalog HTTP validation, routing and roles', () => {
  let app: INestApplication;
  let base: string;
  let access: AccessTokenService;
  const id = randomUUID();
  const list = jest
    .fn()
    .mockResolvedValue({ items: [], offset: 0, limit: 20, total: 0 });
  const detail = jest.fn().mockResolvedValue({ id });
  const create = jest.fn().mockResolvedValue({ id });
  const update = jest.fn().mockResolvedValue({ id });
  const config = {
    jwt: {
      accessSecret: randomBytes(32).toString('hex'),
      issuer: 'catalog-test',
      audience: 'catalog-client',
      accessTtlSeconds: 900,
      refreshTtlSeconds: 3600,
    },
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [ProductsModule] })
      .overrideProvider(ProductsService)
      .useValue({ list, detail, create, update })
      .useMocker((token) =>
        token === ConfigService
          ? new ConfigService(config)
          : token === DataSource
            ? {}
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
    access = app.get(AccessTokenService);
  });
  afterAll(async () => {
    await app?.close();
  });
  async function request(
    method: string,
    path: string,
    body?: unknown,
    role?: string,
  ) {
    const headers: Record<string, string> = {};
    if (role)
      headers.Authorization =
        'Bearer ' + (await access.sign({ id, role }, new Date()));
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + '/api/v1/products' + path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return response.status;
  }
  const valid = {
    name: 'A product',
    priceVnd: '9007199254740993',
    initialStock: 0,
  };
  it.each([undefined, 'CUSTOMER', 'STAFF', 'ADMIN'])(
    'public visibility and mutation authorization for %s',
    async (role) => {
      expect(await request('GET', '', undefined, role)).toBe(200);
      expect(await request('GET', '/' + id, undefined, role)).toBe(200);
      const expected =
        role === 'ADMIN' ? [201, 200] : role ? [403, 403] : [401, 401];
      expect([
        await request('POST', '', valid, role),
        await request('PATCH', '/' + id, { name: 'Changed' }, role),
      ]).toEqual(expected);
    },
  );
  it('transforms only canonical pagination, trims search and defaults sort', async () => {
    expect(await request('GET', '?offset=2&limit=3&q=%20literal%20')).toBe(200);
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        offset: 2,
        limit: 3,
        q: 'literal',
        sort: 'name',
      }),
    );
  });
  it.each([
    'sort=name;DROP TABLE products',
    'sort=stockAvailable',
    'isActive=false',
    'categoryId=anything',
    'limit=101',
    'limit=0',
    'limit=02',
    'offset=-1',
    'offset=1000001',
    'offset=1.5',
    'limit=2&limit=3',
    'q=',
    'q=%20',
    'q=' + 'a'.repeat(101),
    'minPriceVnd=0',
    'maxPriceVnd=9223372036854775808',
    'minPriceVnd=1.5',
    'minPriceVnd=1&minPriceVnd=2',
  ])('rejects invalid or unlisted query %s', async (query) => {
    expect(await request('GET', '?' + query)).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });
  it.each([
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
  ])('rejects unsafe/noncanonical money %s', async (priceVnd) => {
    expect(await request('POST', '', { ...valid, priceVnd }, 'ADMIN')).toBe(
      400,
    );
    expect(await request('PATCH', '/' + id, { priceVnd }, 'ADMIN')).toBe(400);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it.each([-1, 1.5, 2147483648, '1', null])(
    'rejects invalid initial stock %s',
    async (initialStock) => {
      expect(
        await request('POST', '', { ...valid, initialStock }, 'ADMIN'),
      ).toBe(400);
      expect(create).not.toHaveBeenCalled();
    },
  );
  it.each([
    'stockAvailable',
    'initialStock',
    'imagePath',
    'imageUrl',
    'id',
    'role',
    'categoryId',
  ])('rejects protected patch field %s', async (field) => {
    expect(
      await request('PATCH', '/' + id, { [field]: 'protected' }, 'ADMIN'),
    ).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
  it.each([
    { name: null },
    { isActive: null },
    { isActive: 'false' },
    { name: '' },
    { name: 'a'.repeat(251) },
    { description: '' },
  ])('rejects invalid nullable/text/boolean catalog fields', async (body) => {
    expect(await request('PATCH', '/' + id, body, 'ADMIN')).toBe(400);
  });
  it('publishes public reads and Bearer ADMIN mutations with VND response schema', async () => {
    const spec = (await (await fetch(base + '/api/docs-json')).json()) as {
      paths: Record<
        string,
        Record<
          string,
          {
            security?: unknown;
            responses: Record<
              string,
              {
                content: Record<
                  string,
                  {
                    schema: {
                      properties: {
                        data: { properties: Record<string, unknown> };
                      };
                    };
                  }
                >;
              }
            >;
          }
        >
      >;
    };
    expect(spec.paths['/api/v1/products'].get.security).toBeUndefined();
    expect(spec.paths['/api/v1/products'].post.security).toEqual([
      { bearer: [] },
    ]);
    expect(spec.paths['/api/v1/products/{id}'].patch.security).toEqual([
      { bearer: [] },
    ]);
    const fields =
      spec.paths['/api/v1/products/{id}'].get.responses['200'].content[
        'application/json'
      ].schema.properties.data.properties;
    expect(fields.priceVnd).toMatchObject({ type: 'string' });
    expect(fields.imagePath).toBeUndefined();
  });
});
