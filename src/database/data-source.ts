import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { databaseConfig } from '../config/database.config';
import { entities } from './entity-registry';
import { InitialP01793750400000 } from './migrations/1793750400000-initial-p0';

export function createDataSource(
  config: ReturnType<typeof databaseConfig>,
): DataSource {
  return new DataSource({
    type: 'postgres',
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    database: config.database,
    schema: 'public',
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    logging: false,
    parseInt8: false,
    installExtensions: false,
    connectTimeoutMS: 5000,
    extra: {
      max: 5,
      statement_timeout: 15000,
      idle_in_transaction_session_timeout: 15000,
    },
    entities,
    migrations: [InitialP01793750400000],
    migrationsTableName: 'typeorm_migrations',
    migrationsTransactionMode: 'all',
  });
}
