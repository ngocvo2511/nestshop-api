import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Configuration } from '../config/configuration';
import { createDataSource } from './data-source';

@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      inject: [ConfigService],
      useFactory: async (
        config: ConfigService<Configuration, true>,
      ): Promise<DataSource | null> => {
        const db = config.get('db', { infer: true });
        if (!db.enabled) return null; // Explicit isolated scaffold test only.
        const source = createDataSource(db);
        try {
          await source.initialize();
          await source.query('SELECT 1');
          if (await source.showMigrations())
            throw new Error('Migrations must be applied before API startup');
          return source;
        } catch {
          if (source.isInitialized) await source.destroy();
          throw new Error(
            'Database unavailable; check local DB configuration and readiness',
          );
        }
      },
    },
  ],
  exports: [DataSource],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DataSource) private readonly source: DataSource | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.source?.isInitialized) await this.source.destroy();
  }
}
