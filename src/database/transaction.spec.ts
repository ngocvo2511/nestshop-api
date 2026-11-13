import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { transaction } from './transaction';

describe('transaction retry boundary', () => {
  const failure = (code: string) =>
    new QueryFailedError(
      'redacted fixture',
      [],
      Object.assign(new Error('driver failure'), { code }),
    );
  it.each(['40P01', '40001'])(
    'retries %s only within the finite budget',
    async (code) => {
      const runner = jest
        .fn()
        .mockRejectedValueOnce(failure(code))
        .mockRejectedValueOnce(failure(code))
        .mockResolvedValue('committed');
      const operation = (_manager: EntityManager) => {
        void _manager;
        return Promise.resolve('result');
      };
      expect(
        await transaction(
          { transaction: runner } as unknown as DataSource,
          operation,
        ),
      ).toBe('committed');
      expect(runner).toHaveBeenCalledTimes(3);
      expect(runner).toHaveBeenCalledWith('READ COMMITTED', operation);
    },
  );
  it('exhaustion returns the safe availability error; arbitrary DB errors are never retried', async () => {
    const runner = jest.fn().mockRejectedValue(failure('40P01'));
    const source = { transaction: runner } as unknown as DataSource;
    await expect(
      transaction(source, () => Promise.resolve(undefined)),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(runner).toHaveBeenCalledTimes(3);
    runner.mockClear().mockRejectedValue(failure('23514'));
    await expect(
      transaction(source, () => Promise.resolve(undefined)),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    expect(runner).toHaveBeenCalledTimes(1);
  });
  it('a missing database fails closed before entering the operation', async () => {
    const operation = jest.fn();
    await expect(transaction(null, operation)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(operation).not.toHaveBeenCalled();
  });
});
