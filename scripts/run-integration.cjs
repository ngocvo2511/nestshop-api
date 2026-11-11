const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { resolve } = require('node:path');

const project = `nestshop-it-${randomBytes(6).toString('hex')}`;
const password = randomBytes(32).toString('hex');
const root = resolve(__dirname, '..');
const dockerEnv = { ...process.env, TEST_DB_PASSWORD: password };
const composeArgs = ['compose', '-p', project, '-f', 'compose.test.yaml'];

function execute(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: dockerEnv,
      windowsHide: true,
      ...options,
    });
    let output = '';
    if (child.stdout)
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
    let diagnostic = '';
    if (child.stderr)
      child.stderr.on('data', (chunk) => {
        diagnostic += chunk.toString();
      });
    child.once('error', () =>
      reject(new Error(`${command} could not be launched`)),
    );
    child.once('exit', (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(
            new Error(
              `${command} failed (exit ${code}): ${diagnostic.replaceAll(password, '[redacted]').slice(-1500)}`,
            ),
          ),
    );
  });
}

async function main() {
  // Refuse to reuse any pre-existing project. Only this fresh random project is cleaned up.
  if (!/^nestshop-it-[a-f0-9]{12}$/.test(project))
    throw new Error('Invalid disposable project identifier');
  const existing = await execute('docker', [
    'ps',
    '-aq',
    '--filter',
    `label=com.docker.compose.project=${project}`,
  ]);
  if (existing)
    throw new Error(
      'Disposable project unexpectedly exists; nothing was changed',
    );
  console.log(`Starting disposable PostgreSQL project ${project}`);
  try {
    await execute('docker', [
      ...composeArgs,
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '120',
    ]);
    const address = await execute('docker', [
      ...composeArgs,
      'port',
      'postgres-test',
      '5432',
    ]);
    const match = /^127\.0\.0\.1:(\d+)$/.exec(address);
    if (!match)
      throw new Error(
        'Test database did not publish an isolated loopback port',
      );
    await execute(
      process.execPath,
      [
        '--experimental-vm-modules',
        'node_modules/jest/bin/jest.js',
        '--config',
        'jest.integration.config.cjs',
        '--runInBand',
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          TEST_DB_DISPOSABLE: project,
          TEST_DB_HOST: '127.0.0.1',
          TEST_DB_PORT: match[1],
          TEST_DB_PASSWORD: password,
        },
      },
    );
  } finally {
    await execute('docker', [...composeArgs, 'down', '--volumes']);
    console.log(`Removed disposable PostgreSQL project ${project}`);
  }
}

void main().catch((error) => {
  console.error(`${error.message}. No integration pass is claimed.`);
  process.exitCode = 1;
});
