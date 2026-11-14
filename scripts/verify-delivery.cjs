const { Buffer } = require('node:buffer');
const { spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} = require('node:path');

const root = resolve(__dirname, '..');
const reportDir = join(root, 'tmp/reports');
const reportPath = join(reportDir, 'delivery-summary.json');
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');

function entries() {
  const manifest = JSON.parse(
    readFileSync(join(root, 'delivery-files.json'), 'utf8'),
  );
  if (!Array.isArray(manifest.files) || !manifest.files.length)
    throw new Error('Delivery manifest requires an explicit source file list');
  if (
    new Set(
      manifest.files.map((file) =>
        typeof file === 'string' ? file.toLowerCase() : file,
      ),
    ).size !== manifest.files.length
  )
    throw new Error('Duplicate delivery file');
  return manifest.files.map((file) => {
    const normalized = typeof file === 'string' ? file.toLowerCase() : '';
    if (
      typeof file !== 'string' ||
      isAbsolute(file) ||
      file.includes('..') ||
      !/^[-a-zA-Z0-9_./]+$/.test(file) ||
      normalized === 'docs' ||
      normalized.startsWith('docs/') ||
      /(^|\/)(node_modules|dist|coverage|uploads|tmp|temp|postgres-data|\.data|\.git)(\/|$)/.test(
        normalized,
      ) ||
      /\.(pem|key|pfx|p12|zip|log|pdf|png|svg)$/i.test(file) ||
      (/(^|\/)\.env($|\.)/.test(normalized) &&
        !/^\.env(?:\.compose)?\.example$/.test(normalized))
    )
      throw new Error('Unsafe delivery manifest entry');
    const source = resolve(root, file);
    const rel = relative(root, realpathSync(source));
    if (
      rel.startsWith('..') ||
      isAbsolute(rel) ||
      !lstatSync(source).isFile() ||
      lstatSync(source).isSymbolicLink()
    )
      throw new Error('Delivery source must be a regular contained file');
    // Hash and copy the same bytes even if an editor changes the source later.
    const bytes = readFileSync(source);
    return { file, bytes, sha256: hash(bytes) };
  });
}

async function main() {
  mkdirSync(reportDir, { recursive: true });
  const report = {
    date: new Date().toISOString(),
    kind: 'allowlisted public source copy; NOT a Git clean clone',
    node: process.version,
    excluded: [
      'local documents',
      'local secrets',
      'node_modules',
      'dist',
      'runtime volumes',
      'Git metadata',
      'generated artifacts',
    ],
    steps: [],
    pass: false,
  };
  // Invalidate an old successful report before any new preflight can fail.
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  try {
    if (process.argv.length !== 2)
      throw new Error('Unsupported delivery verification argument');
    const list = entries();
    const target = mkdtempSync(join(tmpdir(), 'nestshop-delivery-'));
    report.sourceCopy = target;
    report.fileCount = list.length;
    report.applicationSha256 = hash(
      Buffer.from(
        list
          .map((entry) => entry.file + ':' + entry.sha256)
          .sort()
          .join('\n'),
      ),
    );
    for (const entry of list) {
      const dest = join(target, entry.file);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, entry.bytes);
    }
    mkdirSync(join(target, 'tmp'), { recursive: true });
    writeFileSync(
      join(target, 'tmp/delivery-input-manifest.json'),
      JSON.stringify(
        {
          applicationSha256: report.applicationSha256,
          files: list.map(({ file, sha256 }) => ({ file, sha256 })),
        },
        null,
        2,
      ) + '\n',
    );
    const npm = process.env.npm_execpath;
    if (!npm || !isAbsolute(npm))
      throw new Error('Run through npm run verify:delivery');
    writeFileSync(join(target, 'tmp/npm-user.npmrc'), '');
    const toolKeys = [
      'PATH',
      'HOME',
      'SystemRoot',
      'COMSPEC',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
      'ProgramData',
      'ProgramFiles',
      'ProgramFiles(x86)',
      'ProgramW6432',
      'CommonProgramFiles',
      'CommonProgramFiles(x86)',
      'CommonProgramW6432',
      'HOMEDRIVE',
      'HOMEPATH',
    ];
    const env = {
      ...Object.fromEntries(
        toolKeys
          .filter((key) => process.env[key])
          .map((key) => [key, process.env[key]]),
      ),
      TEMP: tmpdir(),
      TMP: tmpdir(),
      NPM_CONFIG_USERCONFIG: join(target, 'tmp/npm-user.npmrc'),
    };
    const originalModules = resolve(root, 'node_modules');
    env.PATH = (env.PATH ?? '')
      .split(delimiter)
      .filter((entry) => {
        if (!entry) return false;
        const rel = relative(originalModules, resolve(entry));
        return rel.startsWith('..') || isAbsolute(rel);
      })
      .join(delimiter);
    function run(args) {
      return new Promise((resolveRun, reject) => {
        const started = Date.now();
        console.log('Isolated check: npm ' + args.join(' '));
        const child = spawn(process.execPath, [npm, ...args], {
          cwd: target,
          env,
          windowsHide: true,
          stdio: 'inherit',
        });
        child.once('error', () =>
          reject(new Error('Unable to launch isolated check')),
        );
        child.once('exit', (code) => {
          report.steps.push({
            command: 'npm ' + args.join(' '),
            exitCode: code,
            elapsedMs: Date.now() - started,
          });
          if (code === 0) resolveRun();
          else reject(new Error('Isolated check failed; see command result'));
        });
      });
    }
    console.log('Isolated source copy: ' + target);
    if (
      spawnSync('docker', ['compose', 'version'], {
        env,
        windowsHide: true,
        stdio: 'ignore',
      }).status !== 0
    )
      throw new Error('Compose toolchain unavailable');
    await run(['ci', '--no-audit', '--no-fund']);
    for (const script of [
      'lint',
      'format:check',
      'test:cov',
      'test:integration',
      'test:smoke',
      'benchmark',
      'verify:compose',
    ])
      await run(['run', script]);
    const summary = JSON.parse(
      readFileSync(join(target, 'coverage/coverage-summary.json'), 'utf8'),
    );
    const files = Object.fromEntries(
      Object.entries(summary)
        .filter(([file]) => file !== 'total')
        .map(([file, value]) => [
          relative(target, file).split(sep).join('/'),
          value,
        ]),
    );
    writeFileSync(
      join(reportDir, 'delivery-coverage-summary.json'),
      JSON.stringify(
        {
          date: new Date().toISOString(),
          node: process.version,
          total: summary.total,
          files,
        },
        null,
        2,
      ) + '\n',
    );
    copyFileSync(
      join(target, 'tmp/reports/benchmark.json'),
      join(reportDir, 'delivery-benchmark.json'),
    );
    copyFileSync(
      join(target, 'tmp/reports/openapi-audit.json'),
      join(reportDir, 'delivery-openapi-audit.json'),
    );
    report.pass = true;
  } finally {
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(
    'PASS isolated public-source checks. Source copy retained; no clean-clone or Sandbox claim.',
  );
}
void main().catch(() => {
  console.error(
    'Delivery verification failed; see the retained failure report.',
  );
  process.exitCode = 1;
});
