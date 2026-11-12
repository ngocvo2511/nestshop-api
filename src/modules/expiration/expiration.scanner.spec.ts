import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Configuration } from '../../config/configuration';
import { OrdersService } from '../orders/orders.service';
import { ExpirationScanner } from './expiration.scanner';
import { SafeJsonLogger } from '../../common/logging/safe-json.logger';

describe('expiration lifecycle', () => {
  function setup() {
    const query = jest
      .fn<Promise<Array<{ id: string }>>, [string, [string | null, number]]>()
      .mockResolvedValue([]);
    const expire = jest.fn().mockResolvedValue(true);
    const scanner = new ExpirationScanner(
      { query } as unknown as DataSource,
      new ConfigService<Configuration, true>({
        expiry: { scanIntervalSeconds: 2, batchSize: 1 },
      }),
      { expire } as unknown as OrdersService,
    );
    return { scanner, query, expire };
  }
  afterEach(() => jest.useRealTimers());
  it('runs startup, periodic scans, stops timer and rejects new work after shutdown', async () => {
    jest.useFakeTimers();
    const { scanner, query } = setup();
    await scanner.onApplicationBootstrap();
    expect(query).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2000);
    expect(query).toHaveBeenCalledTimes(2);
    await scanner.beforeApplicationShutdown();
    await jest.advanceTimersByTimeAsync(10000);
    await scanner.scan();
    expect(query).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });
  it('coalesces overlapping calls and shutdown drains the active transaction', async () => {
    const { scanner, query, expire } = setup();
    query.mockResolvedValue([{ id: '00000000-0000-4000-8000-000000000001' }]);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    expire.mockReturnValue(held);
    const first = scanner.scan();
    expect(scanner.scan()).toBe(first);
    await Promise.resolve();
    let stopped = false;
    const closing = scanner.beforeApplicationShutdown().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await first;
    await closing;
    expect(expire).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('bounds each batch and rotates cursor even after candidate failure', async () => {
    const { scanner, query, expire } = setup();
    const id = '00000000-0000-4000-8000-000000000001';
    query.mockResolvedValueOnce([{ id }]);
    expire.mockRejectedValueOnce(new Error('sensitive arbitrary text'));
    const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      await scanner.scan();
      await scanner.scan();
      await scanner.scan();
      expect(query.mock.calls.map((call) => call[1])).toEqual([
        [null, 1],
        [id, 1],
        [null, 1],
      ]);
      expect(output.mock.calls.flat().join('')).not.toContain(
        'sensitive arbitrary text',
      );
      expect(output.mock.calls.flat().join('')).toContain('expiry.failed');
    } finally {
      output.mockRestore();
    }
  });
  it('recovers after candidate-query failure', async () => {
    const { scanner, query } = setup();
    query.mockRejectedValueOnce(new Error('secret'));
    const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      await scanner.scan();
      await scanner.scan();
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      output.mockRestore();
    }
  });
  it('logs only recognized diagnostic codes, never arbitrary uppercase error data', () => {
    const lines: string[] = [];
    const logger = new SafeJsonLogger((line) => lines.push(line));
    logger.expiryFailed('order', undefined, {
      driverError: { code: 'PRIVATE_MERCHANT_SECRET' },
      message: 'sensitive signed URL',
    });
    logger.expiryFailed('candidates', undefined, {
      code: 'PRIVATE_ACCESS_TOKEN',
    });
    logger.expiryFailed('order', undefined, {
      driverError: { code: '23514' },
    });
    logger.expiryFailed('order', undefined, {
      code: 'STOCK_RANGE_EXCEEDED',
    });
    const events = lines.map(
      (line) => JSON.parse(line) as { diagnostic: string },
    );
    expect(events.map((event) => event.diagnostic)).toEqual([
      'UNEXPECTED',
      'UNEXPECTED',
      '23514',
      'STOCK_RANGE_EXCEEDED',
    ]);
    expect(lines.join('')).not.toMatch(/PRIVATE_|sensitive signed URL/);
  });
});
