const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { cpus, platform, release, totalmem } = require('node:os');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { createDataSource } = require('../dist/database/data-source');
const { databaseConfig } = require('../dist/config/database.config');
const { startBuiltApplication } = require('../test/helpers/app-process.cjs');

async function main() {
  assert.match(
    process.env.TEST_DB_DISPOSABLE ?? '',
    /^nestshop-it-[a-f0-9]{12}$/,
  );
  assert.equal(process.env.TEST_DB_HOST, '127.0.0.1');
  const db = {
    host: '127.0.0.1',
    port: process.env.TEST_DB_PORT,
    username: 'shop_test',
    database: 'shop_test',
    password: process.env.TEST_DB_PASSWORD,
  };
  const source = createDataSource(
    databaseConfig({
      NODE_ENV: 'test',
      DB_HOST: db.host,
      DB_PORT: db.port,
      DB_USERNAME: db.username,
      DB_DATABASE: db.database,
      DB_PASSWORD: db.password,
    }),
  );
  let app;
  try {
    await source.initialize();
    assert.equal(
      (
        await source.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public'",
        )
      ).length,
      0,
      'Benchmark requires a new empty disposable schema; nothing is reset',
    );
    await source.runMigrations();
    await source.query(`INSERT INTO products(id,name,description,price_vnd,stock_available,is_active)
      SELECT md5('day14-product-' || n)::uuid, 'Benchmark product ' || lpad(n::text,4,'0'),
      'Synthetic benchmark catalog', (10000+n)::bigint, 100, true FROM generate_series(1,1000) n`);
    assert.equal(
      (
        await source.query(
          'SELECT count(*)::int AS n FROM products WHERE is_active',
        )
      )[0].n,
      1000,
    );
    app = await startBuiltApplication(db);
    const path = '/api/v1/products?offset=0&limit=20&sort=name';
    const warmup = 5,
      sampleCount = 50,
      ids = [];
    for (let i = 0; i < warmup + sampleCount; i++) {
      const id = randomUUID();
      const response = await fetch(app.base + path, {
        headers: { 'X-Correlation-ID': id },
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.data.total, 1000);
      assert.equal(body.data.items.length, 20);
      assert.equal(body.data.items[0].name, 'Benchmark product 0001');
      if (i >= warmup) ids.push(id);
    }
    let records;
    const deadline = Date.now() + 3000;
    do {
      records = app
        .output()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter(
          (line) =>
            line.event === 'http.completed' && ids.includes(line.correlationId),
        );
      if (records.length === sampleCount) break;
      await delay(10);
    } while (Date.now() < deadline);
    assert.equal(
      records.length,
      sampleCount,
      'Require one server timing per measured correlation ID',
    );
    const samplesMs = ids.map(
      (id) => records.find((record) => record.correlationId === id).durationMs,
    );
    assert.ok(samplesMs.every((n) => Number.isFinite(n) && n >= 0));
    const sorted = [...samplesMs].sort((a, b) => a - b);
    const p95Ms = sorted[Math.ceil(0.95 * sampleCount) - 1];
    const report = {
      date: new Date().toISOString(),
      node: process.version,
      os: platform() + ' ' + release(),
      cpu: cpus()[0].model,
      logicalCpus: cpus().length,
      memoryGiB: Math.round(totalmem() / 1024 ** 3),
      postgres: (await source.query('SHOW server_version'))[0].server_version,
      dataset: {
        activeProducts: 1000,
        totalProducts: 1000,
        seed: 'generate_series deterministic names/UUIDs/prices',
      },
      path,
      warmup,
      sampleCount,
      sequential: true,
      timing:
        'server process.hrtime.bigint from request-context entry to response finish; existing structured log rounded to 0.01ms; excludes client/network round-trip',
      percentile: 'nearest rank: sorted[ceil(0.95*n)-1]',
      samplesMs,
      minMs: sorted[0],
      maxMs: sorted.at(-1),
      p95Ms,
      targetMs: 500,
      pass: p95Ms < 500,
    };
    const dir = resolve(__dirname, '../tmp/reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, 'benchmark.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(JSON.stringify(report));
    assert.ok(
      report.pass,
      'Observed server p95 misses target; evidence retained',
    );
  } finally {
    await app?.close();
    if (source.isInitialized) await source.destroy();
  }
}
void main().catch(() => {
  console.error(
    'Benchmark failed; no pass claimed. Review retained metrics/setup.',
  );
  process.exitCode = 1;
});
