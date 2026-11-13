import { randomUUID } from 'node:crypto';
import { SafeJsonLogger } from './safe-json.logger';

describe('safe structured log boundary', () => {
  it('discards arbitrary framework payloads, error messages and callback metadata', () => {
    const lines: string[] = [];
    const logger = new SafeJsonLogger((line) => {
      lines.push(line);
    });
    const framework = logger as unknown as Record<
      string,
      (...args: unknown[]) => void
    >;
    for (const method of ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'])
      framework[method](
        { password: 'sensitive-fixture', vnp_SecureHash: 'sensitive-fixture' },
        new Error('sensitive-fixture'),
      );
    logger.startupFailed(new Error('sensitive-fixture'));
    logger.startupFailed(
      new Error(
        'Invalid environment: JWT_ACCESS_SECRET requires sensitive-fixture',
      ),
    );
    const id = randomUUID();
    logger.httpCompleted(id, 'sensitive-fixture', 500, 1.2345);
    logger.imageCleanupFailed(id, id, 'partial');
    const records = lines.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
    expect(lines.join('')).not.toContain('sensitive-fixture');
    expect(records[7]).toMatchObject({
      configurationKey: 'JWT_ACCESS_SECRET',
      event: 'startup.failed',
    });
    expect(records[8]).toMatchObject({
      correlationId: id,
      method: 'OTHER',
      status: 500,
      level: 'error',
      durationMs: 1.23,
    });
    expect(records[9]).toMatchObject({
      productId: id,
      correlationId: id,
      stage: 'partial',
      event: 'image.cleanup_failed',
    });
  });
});
