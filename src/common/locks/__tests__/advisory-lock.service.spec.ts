import { AdvisoryLockService } from '../advisory-lock.service';
import type { DataSource, QueryRunner } from 'typeorm';

describe('AdvisoryLockService', () => {
  it('acquires lock and releases on success', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return [{ locked: true }];
      }
      return [{ unlocked: true }];
    }) as unknown as QueryRunner['query'];
    const runner: Partial<QueryRunner> = {
      connect: jest.fn(),
      release: jest.fn(),
      query,
    };
    const dataSource = {
      createQueryRunner: jest.fn(() => runner),
    } as unknown as DataSource;
    const service = new AdvisoryLockService(dataSource);

    const result = await service.withLock('demo', async () => 'ok');
    expect(result).toBe('ok');
    expect(runner.query).toHaveBeenCalledWith(
      'select pg_try_advisory_lock(hashtext($1)) as locked',
      ['demo'],
    );
    expect(runner.query).toHaveBeenCalledWith(
      'select pg_advisory_unlock(hashtext($1))',
      ['demo'],
    );
    expect(runner.release).toHaveBeenCalled();
  });

  it('throws after timeout when lock is not acquired', async () => {
    jest.useFakeTimers();
    const query = jest.fn(async () => [
      { locked: false },
    ]) as unknown as QueryRunner['query'];
    const runner: Partial<QueryRunner> = {
      connect: jest.fn(),
      release: jest.fn(),
      query,
    };
    const dataSource = {
      createQueryRunner: jest.fn(() => runner),
    } as unknown as DataSource;
    const service = new AdvisoryLockService(dataSource);

    const promise = service.withLock('timeout', async () => 'ok', 300);
    const assertion = expect(promise).rejects.toThrow('acquire lock timeout');
    await jest.advanceTimersByTimeAsync(400);
    await assertion;
    jest.useRealTimers();
  });
});
