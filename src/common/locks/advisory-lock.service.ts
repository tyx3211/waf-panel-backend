import { Injectable, Logger } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

const DEFAULT_TIMEOUT_MS = 30_000;
const RETRY_INTERVAL_MS = 200;

@Injectable()
export class AdvisoryLockService {
  private readonly logger = new Logger(AdvisoryLockService.name);

  constructor(private readonly dataSource: DataSource) {}

  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    let locked = false;
    const start = Date.now();
    try {
      locked = await this.acquire(runner, key, timeoutMs, start);
      if (!locked) {
        throw new Error(`acquire lock timeout: ${key}`);
      }
      return await fn();
    } finally {
      if (locked) {
        await this.release(runner, key);
      }
      await runner.release();
    }
  }

  private async acquire(
    runner: QueryRunner,
    key: string,
    timeoutMs: number,
    start: number,
  ): Promise<boolean> {
    while (true) {
      const rows = (await runner.query(
        'select pg_try_advisory_lock(hashtext($1)) as locked',
        [key],
      )) as Array<{ locked: boolean }>;
      if (rows[0]?.locked) {
        return true;
      }
      if (Date.now() - start > timeoutMs) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
    }
  }

  private async release(runner: QueryRunner, key: string): Promise<void> {
    try {
      await runner.query('select pg_advisory_unlock(hashtext($1))', [key]);
    } catch (err) {
      this.logger.warn(
        `release lock failed: ${key} - ${(err as Error).message}`,
      );
    }
  }
}
