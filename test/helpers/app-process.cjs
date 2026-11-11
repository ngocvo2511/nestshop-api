const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function startBuiltApplication(database, lifetimes = {}) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const cwd = mkdtempSync(join(tmpdir(), 'nestshop-api-smoke-'));
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    DB_ENABLED: 'true',
    DB_HOST: database.host,
    DB_PORT: String(database.port),
    DB_USERNAME: database.username,
    DB_DATABASE: database.database,
    DB_PASSWORD: database.password,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_ACCESS_TTL_SECONDS: String(lifetimes.accessTtlSeconds ?? 900),
    JWT_REFRESH_TTL_SECONDS: String(lifetimes.refreshTtlSeconds ?? 604800),
    UPLOAD_DIRECTORY: join(cwd, 'images'),
    UPLOAD_MAX_BYTES: String(lifetimes.uploadMaxBytes ?? 5242880),
    ORDER_RESERVATION_SECONDS: String(
      lifetimes.orderReservationSeconds ?? 3600,
    ),
    VNPAY_MODE: 'unconfigured',
  };
  const child = spawn(
    process.execPath,
    [resolve(__dirname, '../../dist/main.js')],
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
  const close = async () => {
    if (child.exitCode === null) child.kill();
    await exited;
    if (
      dirname(resolve(cwd)) !== resolve(tmpdir()) ||
      !basename(cwd).startsWith('nestshop-api-smoke-')
    )
      throw new Error('Unsafe temporary cleanup target');
    rmSync(cwd, { recursive: true });
  };
  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null)
        throw new Error('Application exited before readiness');
      try {
        const response = await fetch(base + '/api/v1/health', {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) return { base, close, output: () => output, env };
      } catch {
        /* Poll actual HTTP readiness, never infer it from a sleep. */
      }
      await delay(100);
    }
    throw new Error('Application readiness deadline exceeded');
  } catch (error) {
    await close();
    throw error;
  }
}

module.exports = { startBuiltApplication };
