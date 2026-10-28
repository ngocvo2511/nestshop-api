import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { ApiError } from '../common/http/api-error';

export async function transaction<T>(
  source: DataSource | null,
  operation: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  if (!source) throw new ApiError('SERVICE_UNAVAILABLE');
  for (let attempt = 0; ; attempt++) {
    try {
      return await source.transaction('READ COMMITTED', operation);
    } catch (error) {
      const code =
        error instanceof QueryFailedError
          ? (error.driverError as { code?: string }).code
          : undefined;
      if (code !== '40P01' && code !== '40001') throw error;
      if (attempt >= 2) throw new ApiError('SERVICE_UNAVAILABLE');
    }
  }
}

export async function databaseNow(manager: EntityManager): Promise<Date> {
  const rows: Array<{ now: Date }> = await manager.query(
    'SELECT clock_timestamp() AS now',
  );
  return rows[0].now;
}
