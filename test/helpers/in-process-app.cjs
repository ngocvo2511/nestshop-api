// Coverage-only real HTTP application. No repository/domain mocks or fake database.
const { Test } = require('@nestjs/testing');
const { ConfigModule, ConfigService } = require('@nestjs/config');
const { rmSync } = require('node:fs');
const { basename, dirname, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { validateEnvironment } = require('../../dist/config/configuration');
const {
  SafeJsonLogger,
} = require('../../dist/common/logging/safe-json.logger');
const {
  configureHttp,
  initializeHttp,
} = require('../../dist/common/http/configure-http');
const { configureOpenApi } = require('../../dist/openapi');

async function startInProcess(env, cwd) {
  if (
    process.env.NODE_ENV !== 'test' ||
    !/^nestshop-it-[a-f0-9]{12}$/.test(process.env.TEST_DB_DISPOSABLE ?? '')
  )
    throw new Error('In-process coverage requires the disposable test runner');
  let output = '';
  const logger = new SafeJsonLogger((line) => {
    output += line + '\n';
  });
  const config = validateEnvironment(env);
  // AppModule initializes configuration at first import. Use the validated fixture
  // here too, so the host environment and repository .env cannot enter coverage.
  const originalForRoot = ConfigModule.forRoot;
  let AppModule;
  try {
    ConfigModule.forRoot = function (options) {
      return originalForRoot.call(this, {
        ...options,
        ignoreEnvFile: true,
        validate: () => config,
      });
    };
    ({ AppModule } = require('../../dist/app.module'));
  } finally {
    ConfigModule.forRoot = originalForRoot;
  }
  let app;
  const close = async () => {
    await app?.close();
    if (
      dirname(resolve(cwd)) !== resolve(tmpdir()) ||
      !basename(cwd).startsWith('nestshop-api-smoke-')
    )
      throw new Error('Unsafe temporary cleanup target');
    rmSync(cwd, { recursive: true });
  };
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(config))
      .overrideProvider(SafeJsonLogger)
      .useValue(logger)
      .compile();
    app = module.createNestApplication({ logger, bodyParser: false });
    configureHttp(app, logger);
    configureOpenApi(app);
    await initializeHttp(app);
    await app.listen(config.app.port, config.app.host);
    logger.startupReady(config.vnpay.status);
    return {
      base: `http://${config.app.host}:${config.app.port}`,
      close,
      output: () => output,
      env,
    };
  } catch (error) {
    await close();
    throw new Error('Application exited before readiness', { cause: error });
  }
}
module.exports = { startInProcess };
