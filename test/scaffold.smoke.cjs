const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function launch(port, overrides = {}) {
  // A clean cwd/env ensures local .env and real credentials never enter smoke tests.
  const cwd = mkdtempSync(join(tmpdir(), 'nest-day1-smoke-'));
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    NODE_ENV: 'test',
    DB_ENABLED: 'false',
    HOST: '127.0.0.1',
    PORT: String(port),
    DB_PASSWORD: randomBytes(24).toString('hex'),
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    ...overrides,
  };
  const child = spawn(
    process.execPath,
    [resolve(__dirname, '../dist/main.js')],
    { cwd, env, windowsHide: true },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code));
  });
  return {
    child,
    env,
    exited,
    output: () => output,
    cleanup: async () => {
      if (child.exitCode === null) child.kill();
      await exited;
      rmSync(cwd, { recursive: true });
    },
  };
}

test(
  'built app starts without VNPay, serves HTTP and exposes no future order/payment handlers',
  { timeout: 45000 },
  async () => {
    const port = await freePort();
    const app = launch(port);
    try {
      const base = `http://127.0.0.1:${port}`;
      let response;
      // Cold Node/TypeORM module loading on a busy host must have a bounded
      // readiness budget independent of a fixed number of polling iterations.
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (app.child.exitCode !== null)
          throw new Error('Scaffold exited before readiness');
        try {
          response = await fetch(base + '/api/v1/health', {
            signal: AbortSignal.timeout(500),
          });
          break;
        } catch {
          await delay(100);
        }
      }
      assert.ok(response, 'HTTP readiness timed out');
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.success, true);
      assert.deepEqual(body.data, { status: 'ok' });
      assert.equal(
        body.meta.correlationId,
        response.headers.get('x-correlation-id'),
      );
      for (const route of ['/api/v1/orders', '/api/v1/payments/vnpay/ipn']) {
        assert.equal((await fetch(base + route)).status, 404);
      }
      assert.match(app.output(), /"vnpay":"unconfigured"/);
      assert.ok(!app.output().includes(app.env.JWT_ACCESS_SECRET));
      assert.ok(!app.output().includes(app.env.DB_PASSWORD));
    } finally {
      await app.cleanup();
    }
  },
);

for (const [name, overrides] of [
  ['missing JWT secret', { JWT_ACCESS_SECRET: '' }],
  ['malformed port', { PORT: '3000oops' }],
  ['incomplete VNPay sandbox', { VNPAY_MODE: 'sandbox' }],
]) {
  test(`startup fails closed: ${name}`, { timeout: 20000 }, async () => {
    const app = launch(await freePort(), overrides);
    try {
      const code = await Promise.race([
        app.exited,
        delay(15000, undefined, { ref: false }).then(() => {
          throw new Error('Invalid configuration did not stop startup');
        }),
      ]);
      assert.notEqual(code, 0);
      assert.ok(!app.output().includes(app.env.DB_PASSWORD));
      if (app.env.JWT_ACCESS_SECRET)
        assert.ok(!app.output().includes(app.env.JWT_ACCESS_SECRET));
    } finally {
      await app.cleanup();
    }
  });
}
