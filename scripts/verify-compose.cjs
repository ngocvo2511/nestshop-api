const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:net');
const { resolve } = require('node:path');

const project = `nestshop-verify-${randomBytes(6).toString('hex')}`;
const root = resolve(__dirname, '..');
const dbPassword = randomBytes(32).toString('hex');
const jwtSecret = randomBytes(32).toString('hex');
const adminPassword = randomBytes(24).toString('hex');
const env = {
  ...process.env,
  COMPOSE_DB_PASSWORD: dbPassword,
  COMPOSE_JWT_ACCESS_SECRET: jwtSecret,
  INITIAL_ADMIN_EMAIL: `${randomBytes(8).toString('hex')}@test.invalid`,
  INITIAL_ADMIN_PASSWORD: adminPassword,
};
const args = ['compose', '-p', project, '-f', 'compose.yaml'];
const log = resolve(root, 'tmp/compose-verification.log');
mkdirSync(resolve(root, 'tmp'), { recursive: true });
writeFileSync(
  log,
  'Compose verification (generated local credentials redacted)\n',
);

function redact(value) {
  return [dbPassword, jwtSecret, adminPassword].reduce(
    (text, secret) => text.replaceAll(secret, '[redacted]'),
    value,
  );
}

function docker(commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', commandArgs, {
      cwd: root,
      env,
      windowsHide: true,
    });
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk.toString();
    });
    child.once('error', () =>
      reject(new Error('Docker could not be launched')),
    );
    child.once('exit', (code) => {
      appendFileSync(log, redact(output + errors));
      if (code === 0) resolve(output.trim());
      else
        reject(
          new Error(
            `Docker step failed (exit ${code}); see ignored tmp/compose-verification.log`,
          ),
        );
    });
  });
}

async function main() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  env.COMPOSE_API_PORT = String(server.address().port);
  await new Promise((resolve) => server.close(resolve));
  if (
    await docker([
      'ps',
      '-aq',
      '--filter',
      `label=com.docker.compose.project=${project}`,
    ])
  )
    throw new Error('Project already exists; nothing changed');
  console.log(
    `Building Compose API image; disposable verification project ${project}`,
  );
  try {
    await docker([...args, 'build']);
    console.log('Starting PostgreSQL, migration gate and API readiness checks');
    await docker([...args, 'up', '-d', '--wait', '--wait-timeout', '180']);
    const response = await fetch(
      `http://127.0.0.1:${env.COMPOSE_API_PORT}/api/v1/health`,
      {
        signal: AbortSignal.timeout(10000),
      },
    );
    const health = await response.json();
    if (
      response.status !== 200 ||
      health.success !== true ||
      health.data.status !== 'ok' ||
      health.meta.correlationId !== response.headers.get('x-correlation-id')
    )
      throw new Error('Compose API smoke failed');
    const spec = await (
      await fetch(`http://127.0.0.1:${env.COMPOSE_API_PORT}/api/docs-json`)
    ).json();
    const implementedPaths = [
      '/api/v1/health',
      '/api/v1/auth/register',
      '/api/v1/auth/login',
      '/api/v1/auth/refresh',
      '/api/v1/auth/logout',
      '/api/v1/users/me',
      '/api/v1/users/me/password',
      '/api/v1/admin/users/roles',
      '/api/v1/admin/users/{id}/role',
      '/api/v1/products',
      '/api/v1/products/{id}',
      '/api/v1/products/{id}/image',
      '/api/v1/products/{id}/stock-adjustments',
      '/api/v1/orders',
    ];
    if (
      Object.keys(spec.paths).sort().join(',') !==
      implementedPaths.sort().join(',')
    )
      throw new Error('OpenAPI does not match implemented API scope');
    for (const command of [
      'migration:status',
      'migration:run',
      'seed',
      'seed',
    ]) {
      console.log(`Compose command: ${command}`);
      await docker([...args, 'exec', '-T', 'api', 'npm', 'run', command]);
    }
    // Values are inherited from the child environment rather than included in arguments/logs.
    for (let i = 0; i < 2; i++) {
      await docker([
        ...args,
        'run',
        '--rm',
        '--no-deps',
        '-e',
        'INITIAL_ADMIN_EMAIL',
        '-e',
        'INITIAL_ADMIN_PASSWORD',
        'api',
        'node',
        'dist/database/cli.js',
        'admin',
      ]);
    }
    await docker([
      ...args,
      'exec',
      '-T',
      'api',
      'node',
      '-e',
      "require('node:fs').writeFileSync('/app/uploads/day2-proof.txt','persisted')",
    ]);
    console.log(
      'Recreating only this verification project containers to check DB/upload persistence',
    );
    await docker([...args, 'rm', '--force', '--stop', 'api', 'postgres']);
    await docker([...args, 'up', '-d', '--wait', '--wait-timeout', '180']);
    const contents = await docker([
      ...args,
      'exec',
      '-T',
      'api',
      'node',
      '-e',
      "process.stdout.write(require('node:fs').readFileSync('/app/uploads/day2-proof.txt','utf8'))",
    ]);
    if (contents !== 'persisted')
      throw new Error('Upload volume did not persist');
    const count = await docker([
      ...args,
      'exec',
      '-T',
      'api',
      'node',
      '-e',
      "const {createDataSource}=require('./dist/database/data-source');const {databaseConfig}=require('./dist/config/database.config');const d=createDataSource(databaseConfig(process.env));(async()=>{try{await d.initialize();const r=await d.query('SELECT (SELECT count(*) FROM products)::text AS products, (SELECT count(*) FROM users)::text AS users');process.stdout.write(JSON.stringify(r[0]));}finally{if(d.isInitialized)await d.destroy();}})().catch(()=>{process.exitCode=1;});",
    ]);
    if (JSON.parse(count).products !== '3' || JSON.parse(count).users !== '1')
      throw new Error('Seed/admin rows did not persist exactly once');
    console.log(
      'PASS: Compose build/start, migrations, repeated seed/admin, HTTP and DB/upload persistence',
    );
  } finally {
    await docker([...args, 'down', '--volumes']);
    console.log(
      `Removed only verification project ${project} and its newly created volumes`,
    );
  }
}

void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
