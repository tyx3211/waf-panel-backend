import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService {
  constructor(private readonly dataSource: DataSource) {}

  async check() {
    const dbOk = await this.checkDb();
    return {
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk ? 'up' : 'down',
    };
  }

  private async checkDb(): Promise<boolean> {
    try {
      await this.dataSource.query('select 1');
      return true;
    } catch {
      return false;
    }
  }
}
