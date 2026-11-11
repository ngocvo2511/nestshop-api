import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      skipProcessEnv: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    HealthModule,
  ],
})
export class AppModule {}
