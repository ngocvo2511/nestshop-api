import { existsSync } from 'node:fs';
import { databaseConfig } from '../config/database.config';
import { createDataSource } from './data-source';
import { seedDevelopment } from './seeds/development.seed';
import { adminInput, setupInitialAdmin } from './seeds/initial-admin';

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const command = process.argv[2];
  if (!['migrate', 'revert', 'status', 'seed', 'admin'].includes(command))
    throw new Error('Unsupported database command');
  const config = databaseConfig(process.env);
  if (!config.enabled)
    throw new Error('Database commands require DB_ENABLED=true');
  // Validate admin input before connecting; credentials are never command-line arguments.
  const input = command === 'admin' ? adminInput(process.env) : undefined;
  const source = createDataSource(config);
  try {
    await source.initialize();
    if (command === 'migrate') {
      const applied = await source.runMigrations();
      console.log(`Applied ${applied.length} migration(s)`);
    } else if (command === 'revert') {
      await source.undoLastMigration();
      console.log('Last migration reverted');
    } else if (command === 'status') {
      console.log(
        (await source.showMigrations())
          ? 'Migrations pending'
          : 'Migrations current',
      );
    } else if (command === 'seed') {
      await seedDevelopment(source, process.env.NODE_ENV ?? 'development');
      console.log('Development seed completed (existing records preserved)');
    } else if (input) {
      console.log(`Initial admin: ${await setupInitialAdmin(source, input)}`);
    }
  } finally {
    if (source.isInitialized) await source.destroy();
  }
}

void main().catch((error) => {
  const diagnostic =
    error instanceof Error &&
    (error.message.startsWith('Invalid environment:') ||
      error.message.startsWith('Initial admin email'))
      ? error.message
      : 'Database command failed; check local configuration, DB readiness and migration history';
  console.error(diagnostic);
  process.exitCode = 1;
});
