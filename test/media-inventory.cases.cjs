const {
  describe,
  beforeAll,
  afterAll,
  test,
  expect,
  jest: jestApi,
} = require('@jest/globals');
const { Buffer } = require('node:buffer');
const { randomUUID, randomBytes } = require('node:crypto');
const {
  mkdir,
  readdir,
  rmdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} = require('node:fs/promises');
const { join } = require('node:path');
const { Blob } = require('node:buffer');
const { FormData } = globalThis;
const { setTimeout: delay } = require('node:timers/promises');
const sharp = require('sharp');
const { startBuiltApplication } = require('./helpers/app-process.cjs');

function registerMediaInventoryCases(getSource, appDatabase) {
  describe('Day7 media/inventory actual API, files and PostgreSQL', () => {
    let source;
    let app;
    const actors = {};
    const images = {};
    beforeAll(async () => {
      source = getSource();
      app = await startBuiltApplication(appDatabase());
      for (const format of ['jpeg', 'png', 'webp'])
        images[format] = await sharp({
          create: { width: 3, height: 2, channels: 3, background: '#aabbcc' },
        })
          .toFormat(format)
          .toBuffer();
      for (const role of ['CUSTOMER', 'STAFF', 'ADMIN']) {
        const credentials = {
          email: `${randomUUID()}@media.invalid`,
          password: randomBytes(24).toString('hex'),
        };
        const registered = await json('POST', '/auth/register', credentials);
        expect(registered.status).toBe(201);
        if (role !== 'CUSTOMER')
          await source.query('UPDATE users SET role=$2 WHERE id=$1', [
            registered.body.data.id,
            role,
          ]);
        const login = await json('POST', '/auth/login', credentials);
        actors[role] = {
          id: registered.body.data.id,
          token: login.body.data.accessToken,
        };
      }
    });
    afterAll(async () => {
      await app?.close();
    });
    async function json(method, path, body, role) {
      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (role) headers.Authorization = 'Bearer ' + actors[role].token;
      const response = await fetch(app.base + '/api/v1' + path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    }
    async function product(stock = 10, active = true) {
      const id = randomUUID();
      await source.query(
        'INSERT INTO products (id,name,price_vnd,stock_available,is_active) VALUES ($1,$2,$3,$4,$5)',
        [id, 'Day7 fixture', '1000', stock, active],
      );
      return id;
    }
    async function row(id) {
      return (
        await source.query('SELECT * FROM products WHERE id=$1', [id])
      )[0];
    }
    function audit(id) {
      return source.query(
        'SELECT * FROM inventory_adjustment_audit WHERE product_id=$1 ORDER BY created_at,id',
        [id],
      );
    }
    async function files() {
      try {
        return (await readdir(app.env.UPLOAD_DIRECTORY)).sort();
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    }
    function form(
      buffer = images.png,
      mime = 'image/png',
      name = 'image.png',
      field = 'file',
    ) {
      const body = new FormData();
      body.append(field, new Blob([buffer], { type: mime }), name);
      return body;
    }
    async function upload(
      id,
      body = form(),
      role = 'ADMIN',
      base = app.base,
      token = actors[role]?.token,
    ) {
      const response = await fetch(base + `/api/v1/products/${id}/image`, {
        method: 'POST',
        body,
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      });
      return { status: response.status, body: await response.json() };
    }
    async function waitProduct(count) {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        const result = await source.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%products%' AND query LIKE '%FOR UPDATE%'",
        );
        if (result[0].count >= count) return;
        await delay(15);
      }
      throw new Error('Expected independent product lock waiters');
    }
    async function block(id) {
      const runner = source.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      await runner.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [
        id,
      ]);
      return runner;
    }
    async function concurrent(id, first, second) {
      const runner = await block(id);
      const pending = [];
      try {
        pending.push(first());
        await waitProduct(1);
        pending.push(second());
        await waitProduct(2);
        await runner.commitTransaction();
        return await Promise.all(pending);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await Promise.allSettled(pending);
      }
    }

    test.each([undefined, 'CUSTOMER', 'STAFF'])(
      '%s cannot upload or adjust stock; no disk/DB changes',
      async (role) => {
        const id = await product();
        const before = await files();
        expect(
          (
            await upload(
              id,
              form(),
              role ?? null,
              app.base,
              role ? actors[role].token : null,
            )
          ).status,
        ).toBe(role ? 403 : 401);
        expect(
          (
            await json(
              'POST',
              `/products/${id}/stock-adjustments`,
              { quantityDelta: 1, reason: 'Restock' },
              role,
            )
          ).status,
        ).toBe(role ? 403 : 401);
        expect((await row(id)).image_path).toBeNull();
        expect((await row(id)).stock_available).toBe(10);
        expect(await audit(id)).toHaveLength(0);
        expect(await files()).toEqual(before);
      },
    );

    test.each(['jpeg', 'png', 'webp'])(
      'ADMIN %s upload stores generated reference and public bytes with safe headers',
      async (format) => {
        const id = await product();
        const result = await upload(
          id,
          form(images[format], 'image/' + format, 'untrusted-name.' + format),
        );
        expect(result.status).toBe(200);
        expect(result.body.data).toEqual({
          productId: id,
          imageUrl: `/api/v1/products/${id}/image`,
        });
        const stored = await row(id);
        expect(stored.image_path).toMatch(/^[0-9a-f-]{36}\.(jpeg|png|webp)$/);
        expect(
          JSON.stringify(result.body).includes(app.env.UPLOAD_DIRECTORY),
        ).toBe(false);
        const response = await fetch(app.base + result.body.data.imageUrl);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/' + format);
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('cache-control')).toBe('no-store');
        const buffer = Buffer.from(await response.arrayBuffer());
        expect(await sharp(buffer).metadata()).toMatchObject({
          format,
          width: 3,
          height: 2,
        });
        expect(buffer).toEqual(
          await readFile(join(app.env.UPLOAD_DIRECTORY, stored.image_path)),
        );
      },
    );

    test('spoofed/invalid/truncated/unsupported content, unsafe names, multipart shape and oversize never change reference/files', async () => {
      const id = await product();
      const before = await files();
      const inputs = [
        [form(images.png, 'image/jpeg'), 415],
        [form(Buffer.from('<html>bad</html>'), 'image/png'), 415],
        [form(images.png.subarray(0, 16)), 415],
        [form(Buffer.from('<svg/>'), 'image/png'), 415],
        [form(images.png, 'image/png', '../escape.png'), 415],
        [form(images.png, 'image/png', 'C:\\host.png'), 415],
        [form(Buffer.alloc(5242881)), 413],
        [new FormData(), 400],
        [form(images.png, 'image/png', 'x.png', 'other'), 400],
      ];
      const extra = form();
      extra.append('imagePath', 'client');
      inputs.push([extra, 400]);
      const multiple = form();
      multiple.append(
        'file',
        new Blob([images.png], { type: 'image/png' }),
        'second.png',
      );
      inputs.push([multiple, 400]);
      for (const [body, status] of inputs) {
        const result = await upload(id, body);
        expect(result.status).toBe(status);
        expect((await row(id)).image_path).toBeNull();
        expect(await files()).toEqual(before);
      }
    });

    test('exact5MiB input is accepted and a smaller environment cap is enforced', async () => {
      const id = await product();
      const padded = Buffer.concat([
        images.png,
        Buffer.alloc(5242880 - images.png.length),
      ]);
      expect((await upload(id, form(padded))).status).toBe(200);
      const short = await startBuiltApplication(appDatabase(), {
        uploadMaxBytes: 64,
      });
      try {
        // The second app has its own signing key; use verified claims from its own issuer.
        const { SignJWT } = await import('jose');
        const { TextEncoder } = require('node:util');
        const token = await new SignJWT({ role: 'ADMIN', tokenType: 'access' })
          .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
          .setSubject(actors.ADMIN.id)
          .setIssuer('nestshop-api')
          .setAudience('nestshop-clients')
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(new TextEncoder().encode(short.env.JWT_ACCESS_SECRET));
        const before = await row(id);
        expect(
          (await upload(id, form(), 'ADMIN', short.base, token)).status,
        ).toBe(413);
        expect(await row(id)).toEqual(before);
      } finally {
        await short.close();
      }
    });

    test('missing/inactive/missing-file and traversal/junction references return safe404; inactive Admin upload is permitted', async () => {
      const beforeMissingUpload = await files();
      expect((await upload(randomUUID())).status).toBe(404);
      expect(await files()).toEqual(beforeMissingUpload);
      const id = await product(10, false);
      expect((await upload(id)).status).toBe(200);
      expect(
        (await fetch(app.base + `/api/v1/products/${id}/image`)).status,
      ).toBe(404);
      const missing = await product();
      for (const target of [missing, randomUUID()]) {
        const response = await fetch(
          app.base + `/api/v1/products/${target}/image`,
        );
        expect(response.status).toBe(404);
        expect((await response.json()).error.code).toBe('NOT_FOUND');
      }
      await source.query('UPDATE products SET image_path=$2 WHERE id=$1', [
        missing,
        randomUUID() + '.png',
      ]);
      expect(
        (await fetch(app.base + `/api/v1/products/${missing}/image`)).status,
      ).toBe(404);
      for (const reference of [
        'ordinary.png',
        'products/ordinary.png',
        '..%2fsecret.png',
      ]) {
        // Exercise DB-allowed unsafe/non-generated forms; DB itself rejects literal traversal/absolute paths.
        await source.query('UPDATE products SET image_path=$2 WHERE id=$1', [
          missing,
          reference,
        ]);
        expect(
          (await fetch(app.base + `/api/v1/products/${missing}/image`)).status,
        ).toBe(404);
      }
      const target = join(app.env.UPLOAD_DIRECTORY, 'external');
      await mkdir(target);
      await writeFile(join(target, 'secret'), 'retained');
      const reference = randomUUID() + '.png';
      const link = join(app.env.UPLOAD_DIRECTORY, reference);
      await symlink(target, link, 'junction');
      await source.query('UPDATE products SET image_path=$2 WHERE id=$1', [
        missing,
        reference,
      ]);
      expect(
        (await fetch(app.base + `/api/v1/products/${missing}/image`)).status,
      ).toBe(404);
      expect(await readFile(join(target, 'secret'), 'utf8')).toBe('retained');
      await rm(link);
      await unlink(join(target, 'secret'));
      await rmdir(target); // Empty fixture directory only.
    });

    test('replacement and concurrent replacements leave exactly one winning reference and never delete a still-shared image', async () => {
      const before = await files();
      const id = await product();
      const shared = await product();
      await upload(id);
      const old = (await row(id)).image_path;
      await source.query('UPDATE products SET image_path=$2 WHERE id=$1', [
        shared,
        old,
      ]);
      const results = await concurrent(
        id,
        () => upload(id, form(images.jpeg, 'image/jpeg', 'a.jpeg')),
        () => upload(id, form(images.webp, 'image/webp', 'b.webp')),
      );
      expect(results.map((result) => result.status)).toEqual([200, 200]);
      const winner = (await row(id)).image_path;
      expect(
        (await files()).filter((name) => !before.includes(name)).sort(),
      ).toEqual([old, winner].sort());
      expect(winner).not.toBe(old);
      expect(
        await readFile(join(app.env.UPLOAD_DIRECTORY, winner)),
      ).not.toHaveLength(0);
      expect(
        await readFile(join(app.env.UPLOAD_DIRECTORY, old)),
      ).not.toHaveLength(0); // Still referenced by another product.
      await upload(shared);
      await expect(
        readFile(join(app.env.UPLOAD_DIRECTORY, old)),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      expect(
        (await fetch(app.base + `/api/v1/products/${id}/image`)).status,
      ).toBe(200);
    });

    test('DB image-update failure removes orphan; failed orphan cleanup emits only safe identifiers; storage failure leaves DB unchanged', async () => {
      const { Test } = require('@nestjs/testing');
      const { ConfigService } = require('@nestjs/config');
      const { DataSource } = require('typeorm');
      const {
        ProductsModule,
      } = require('../dist/modules/products/products.module');
      const {
        ImageStorage,
      } = require('../dist/modules/products/image-storage');
      const {
        AccessTokenService,
      } = require('../dist/modules/auth/access-token.service');
      const {
        SafeJsonLogger,
      } = require('../dist/common/logging/safe-json.logger');
      const {
        configureHttp,
        initializeHttp,
      } = require('../dist/common/http/configure-http');
      const lines = [];
      const logger = new SafeJsonLogger((line) => lines.push(line));
      const config = new ConfigService({
        jwt: {
          accessSecret: randomBytes(32).toString('hex'),
          issuer: 'fault',
          audience: 'fault',
          accessTtlSeconds: 900,
        },
        upload: { directory: app.env.UPLOAD_DIRECTORY, maxBytes: 5242880 },
      });
      const module = await Test.createTestingModule({
        imports: [ProductsModule],
      })
        .overrideProvider(SafeJsonLogger)
        .useValue(logger)
        .useMocker((token) =>
          token === DataSource
            ? source
            : token === ConfigService
              ? config
              : undefined,
        )
        .compile();
      const faultApp = module.createNestApplication({
        logger,
        bodyParser: false,
      });
      configureHttp(faultApp, logger);
      await initializeHttp(faultApp);
      await faultApp.listen(0, '127.0.0.1');
      const base = await faultApp.getUrl();
      const token = await faultApp
        .get(AccessTokenService)
        .sign({ id: actors.ADMIN.id, role: 'ADMIN' }, new Date());
      const storage = faultApp.get(ImageStorage);
      const id = await product();
      const constraint = 'image_fault_' + randomBytes(8).toString('hex');
      await source.query(
        `ALTER TABLE products ADD CONSTRAINT ${constraint} CHECK (id <> '${id}'::uuid OR image_path IS NULL)`,
      );
      try {
        const before = await files();
        const failed = await upload(id, form(), 'ADMIN', base, token);
        expect(failed.status).toBe(500);
        expect(await files()).toEqual(before);
        expect((await row(id)).image_path).toBeNull();
        const cleanup = jestApi
          .spyOn(storage, 'remove')
          .mockRejectedValue(new Error('host-path-and-secret'));
        const orphaned = await upload(id, form(), 'ADMIN', base, token);
        expect(orphaned.status).toBe(500);
        expect(cleanup).toHaveBeenCalled();
        cleanup.mockRestore();
        const orphans = (await files()).filter(
          (name) => !before.includes(name),
        );
        expect(orphans).toHaveLength(1);
        const diagnostics = lines
          .map((line) => JSON.parse(line))
          .filter((line) => line.event === 'image.cleanup_failed');
        expect(diagnostics).toHaveLength(1);
        expect(Object.keys(diagnostics[0]).sort()).toEqual(
          [
            'timestamp',
            'level',
            'event',
            'productId',
            'correlationId',
            'stage',
          ].sort(),
        );
        expect(diagnostics[0]).toMatchObject({
          productId: id,
          stage: 'orphan',
        });
        expect(
          JSON.stringify(orphaned.body).includes('host-path-and-secret'),
        ).toBe(false);
        expect(lines.join('').includes('host-path-and-secret')).toBe(false);
        expect(lines.join('').includes(app.env.UPLOAD_DIRECTORY)).toBe(false);
        await unlink(join(app.env.UPLOAD_DIRECTORY, orphans[0]));
        const write = jestApi
          .spyOn(storage, 'write')
          .mockRejectedValue(new Error('host-path-and-secret'));
        const failedStorage = await upload(id, form(), 'ADMIN', base, token);
        expect(failedStorage.status).toBe(500);
        expect((await row(id)).image_path).toBeNull();
        expect(await files()).toEqual(before);
        write.mockRestore();
      } finally {
        jestApi.restoreAllMocks();
        await source.query(
          `ALTER TABLE products DROP CONSTRAINT ${constraint}`,
        );
        await faultApp.close();
      }
    });

    test('orphan cleanup waits for an uncertain commit before checking references and keeps the committed file', async () => {
      const {
        ProductImagesService,
      } = require('../dist/modules/products/product-images.service');
      const {
        ImageStorage,
      } = require('../dist/modules/products/image-storage');
      const { ConfigService } = require('@nestjs/config');
      const {
        SafeJsonLogger,
      } = require('../dist/common/logging/safe-json.logger');
      const id = await product();
      let first = true;
      let primary;
      let signal;
      const ready = new Promise((resolve) => {
        signal = resolve;
      });
      // Real SQL and row locks; only the primary commit acknowledgement is fault-injected.
      const uncertain = new Proxy(source, {
        get(target, key) {
          if (key !== 'transaction') return Reflect.get(target, key);
          return async (isolation, operation) => {
            if (!first) return target.transaction(isolation, operation);
            first = false;
            primary = target.createQueryRunner();
            await primary.connect();
            await primary.startTransaction(isolation);
            await operation(primary.manager);
            signal();
            throw new Error('Controlled uncertain commit');
          };
        },
      });
      const lines = [];
      const logger = new SafeJsonLogger((line) => lines.push(line));
      const storage = new ImageStorage(
        new ConfigService({
          upload: { directory: app.env.UPLOAD_DIRECTORY, maxBytes: 5242880 },
        }),
        logger,
      );
      const service = new ProductImagesService(uncertain, storage, logger);
      const pending = service
        .upload(
          id,
          {
            buffer: images.png,
            mimetype: 'image/png',
            originalname: 'image.png',
          },
          randomUUID(),
        )
        .catch((error) => error);
      try {
        await ready;
        await waitProduct(1); // Cleanup must wait behind the still-uncommitted reference write.
        await primary.commitTransaction();
        expect((await pending).message).toBe('Controlled uncertain commit');
        const stored = await row(id);
        expect(stored.image_path).not.toBeNull();
        expect(
          await readFile(join(app.env.UPLOAD_DIRECTORY, stored.image_path)),
        ).not.toHaveLength(0);
        expect(
          (await fetch(app.base + `/api/v1/products/${id}/image`)).status,
        ).toBe(200);
        expect(
          lines.some(
            (line) => JSON.parse(line).event === 'image.cleanup_failed',
          ),
        ).toBe(false);
      } finally {
        if (primary?.isTransactionActive) await primary.rollbackTransaction();
        if (primary) await primary.release();
        await Promise.allSettled([pending]);
      }
    });

    test('stock adjustment enforces role/input/result bounds and persists exact actor/audit atomically on inactive products too', async () => {
      const id = await product(10, false);
      const result = await json(
        'POST',
        `/products/${id}/stock-adjustments`,
        { quantityDelta: -3, reason: '  Damaged stock  ' },
        'ADMIN',
      );
      expect(result.status).toBe(201);
      expect(result.body.data).toMatchObject({
        productId: id,
        actorUserId: actors.ADMIN.id,
        previousStock: 10,
        quantityDelta: -3,
        newStock: 7,
        reason: 'Damaged stock',
      });
      expect((await row(id)).stock_available).toBe(7);
      const audits = await audit(id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actor_user_id: actors.ADMIN.id,
        previous_stock: 10,
        new_stock: 7,
        quantity_delta: -3,
      });
      const before = await row(id);
      for (const body of [
        { quantityDelta: 0, reason: 'x' },
        { quantityDelta: 1.5, reason: 'x' },
        { quantityDelta: '1', reason: 'x' },
        { quantityDelta: 2147483648, reason: 'x' },
        { quantityDelta: -2147483649, reason: 'x' },
        { quantityDelta: 1 },
        { quantityDelta: 1, reason: '' },
        { quantityDelta: 1, reason: ' ' },
        { quantityDelta: 1, reason: 'x', stockAvailable: 2 },
        { quantityDelta: 1, reason: 'x', actorUserId: randomUUID() },
      ])
        expect(
          (
            await json(
              'POST',
              `/products/${id}/stock-adjustments`,
              body,
              'ADMIN',
            )
          ).status,
        ).toBe(400);
      for (const quantityDelta of [-8, 2147483647, -2147483648])
        expect(
          (
            await json(
              'POST',
              `/products/${id}/stock-adjustments`,
              { quantityDelta, reason: 'Bounds' },
              'ADMIN',
            )
          ).body.error.code,
        ).toBe('STOCK_RANGE_EXCEEDED');
      expect(await row(id)).toEqual(before);
      expect(await audit(id)).toHaveLength(1);
      expect(
        (await json('PATCH', `/products/${id}`, { stockAvailable: 0 }, 'ADMIN'))
          .status,
      ).toBe(400);
      expect(
        (
          await json(
            'POST',
            `/products/${randomUUID()}/stock-adjustments`,
            { quantityDelta: 1, reason: 'Missing' },
            'ADMIN',
          )
        ).status,
      ).toBe(404);
    });

    test('integer upper/lower result boundaries are exact and accepted calls remain additive', async () => {
      const id = await product(0);
      expect(
        (
          await json(
            'POST',
            `/products/${id}/stock-adjustments`,
            { quantityDelta: 2147483647, reason: 'Upper boundary' },
            'ADMIN',
          )
        ).status,
      ).toBe(201);
      expect(
        (
          await json(
            'POST',
            `/products/${id}/stock-adjustments`,
            { quantityDelta: 1, reason: 'Overflow' },
            'ADMIN',
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await json(
            'POST',
            `/products/${id}/stock-adjustments`,
            { quantityDelta: -2147483647, reason: 'Lower boundary' },
            'ADMIN',
          )
        ).status,
      ).toBe(201);
      for (let index = 0; index < 2; index++)
        expect(
          (
            await json(
              'POST',
              `/products/${id}/stock-adjustments`,
              { quantityDelta: 1, reason: 'Repeated additive' },
              'ADMIN',
            )
          ).status,
        ).toBe(201);
      expect((await row(id)).stock_available).toBe(2);
      expect(await audit(id)).toHaveLength(4);
    });

    test('audit failure rolls back product stock and updatedAt', async () => {
      const id = await product();
      const before = await row(id);
      const constraint = 'inventory_fault_' + randomBytes(8).toString('hex');
      await source.query(
        `ALTER TABLE inventory_adjustment_audit ADD CONSTRAINT ${constraint} CHECK (product_id <> '${id}'::uuid)`,
      );
      try {
        const result = await json(
          'POST',
          `/products/${id}/stock-adjustments`,
          { quantityDelta: 1, reason: 'Rollback' },
          'ADMIN',
        );
        expect(result.status).toBe(500);
        expect(result.body.error.code).toBe('INTERNAL_ERROR');
        expect(await row(id)).toEqual(before);
        expect(await audit(id)).toHaveLength(0);
      } finally {
        await source.query(
          `ALTER TABLE inventory_adjustment_audit DROP CONSTRAINT ${constraint}`,
        );
      }
    });

    test('image replacement and stock adjustment serialize without clobbering each other', async () => {
      const id = await product(10);
      const result = await concurrent(
        id,
        () => upload(id),
        () =>
          json(
            'POST',
            `/products/${id}/stock-adjustments`,
            { quantityDelta: 3, reason: 'Together' },
            'ADMIN',
          ),
      );
      expect(result.map((entry) => entry.status)).toEqual([200, 201]);
      const current = await row(id);
      expect(current.stock_available).toBe(13);
      expect(
        await readFile(join(app.env.UPLOAD_DIRECTORY, current.image_path)),
      ).not.toHaveLength(0);
      expect(await audit(id)).toHaveLength(1);
    });

    test('two contending decrements of the last unit have one winner and exactly one committed audit', async () => {
      const id = await product(1);
      const call = () =>
        json(
          'POST',
          `/products/${id}/stock-adjustments`,
          { quantityDelta: -1, reason: 'Last unit' },
          'ADMIN',
        );
      const results = await concurrent(id, call, call);
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      expect((await row(id)).stock_available).toBe(0);
      const audits = await audit(id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        previous_stock: 1,
        new_stock: 0,
        quantity_delta: -1,
      });
    });

    test('concurrent additive adjustments chain audit snapshots without lost updates', async () => {
      const id = await product(10);
      const call = (quantityDelta) =>
        json(
          'POST',
          `/products/${id}/stock-adjustments`,
          { quantityDelta, reason: 'Concurrent' },
          'ADMIN',
        );
      const results = await concurrent(
        id,
        () => call(3),
        () => call(4),
      );
      expect(results.map((result) => result.status)).toEqual([201, 201]);
      expect((await row(id)).stock_available).toBe(17);
      expect(
        (await audit(id)).map((entry) => [
          entry.previous_stock,
          entry.new_stock,
        ]),
      ).toEqual([
        [10, 13],
        [13, 17],
      ]);
    });
  });
}
module.exports = { registerMediaInventoryCases };
