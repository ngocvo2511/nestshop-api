import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Configuration } from './config/configuration';
import { configureHttp, initializeHttp } from './common/http/configure-http';
import { SafeJsonLogger } from './common/logging/safe-json.logger';
import { configureOpenApi } from './openapi';

const logger = new SafeJsonLogger();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger,
    bodyParser: false,
    abortOnError: false,
  });
  app.enableShutdownHooks();
  configureHttp(app, logger);
  configureOpenApi(app);
  const config = app.get(ConfigService<Configuration, true>);
  const { host, port } = config.get('app', { infer: true });
  const { status } = config.get('vnpay', { infer: true });
  await initializeHttp(app);
  await app.listen(port, host);
  logger.startupReady(status);
}

void bootstrap().catch((error: unknown) => {
  logger.startupFailed(error);
  process.exitCode = 1;
});
