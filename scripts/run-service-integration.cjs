const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { resolve } = require('node:path');

async function runService({ coverage, benchmark }) {
  // Opt-in only for an ephemeral GitHub Actions service, never an arbitrary local database.
  if (
    process.env.CI !== 'true' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.TEST_DB_HOST !== '127.0.0.1' ||
    !/^[1-9]\d{0,4}$/.test(process.env.TEST_DB_PORT ?? '') ||
    Number(process.env.TEST_DB_PORT) > 65535 ||
    !process.env.TEST_DB_PASSWORD
  )
    throw new Error('Refusing an unverified CI PostgreSQL service');
  const args = benchmark
    ? ['scripts/benchmark-products.cjs']
    : [
        '--experimental-vm-modules',
        'node_modules/jest/bin/jest.js',
        '--config',
        coverage ? 'jest.coverage.config.cjs' : 'jest.integration.config.cjs',
        '--runInBand',
      ];
  await new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: resolve(__dirname, '..'),
      windowsHide: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DB_DISPOSABLE: 'nestshop-it-' + randomBytes(6).toString('hex'),
        TEST_IN_PROCESS: coverage ? 'true' : 'false',
      },
    });
    child.once('error', () => reject(new Error('Unable to launch CI tests')));
    child.once('exit', (code) =>
      code === 0
        ? resolveRun()
        : reject(new Error('CI checks failed; no pass claimed')),
    );
  });
}
module.exports = { runService };
