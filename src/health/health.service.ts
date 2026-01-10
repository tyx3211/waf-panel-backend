import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LokiService } from '../loki/loki.service';
import { AlertMailService } from '../alerts/alert-mail.service';
import { HealthCheckResponseDto } from './dto/health.dto';

@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly lokiService: LokiService,
    private readonly alertMailService: AlertMailService,
  ) {}

  async check(): Promise<HealthCheckResponseDto> {
    const [dbOk, lokiResult, smtpResult] = await Promise.all([
      this.checkDb(),
      this.checkLoki(),
      this.checkSmtp(),
    ]);

    // Determine overall status
    let status: 'ok' | 'degraded' | 'unhealthy' = 'ok';
    if (!dbOk) {
      status = 'unhealthy'; // DB is critical
    } else if (lokiResult.status === 'down' || smtpResult.status === 'down') {
      status = 'degraded'; // Non-critical services down
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      components: {
        db: { status: dbOk ? 'up' : 'down' },
        loki: lokiResult,
        smtp: smtpResult,
      },
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

  private async checkLoki(): Promise<{
    status: 'up' | 'down' | 'unconfigured';
    url?: string;
  }> {
    // Check if Loki client is configured
    // LokiService doesn't expose config directly, so we try a simple query
    try {
      const result = await this.lokiService.queryLogs({
        query: '{job="waf_logs"}',
        start: Date.now() - 60000,
        end: Date.now(),
        limit: 1,
      });
      // If we get a result (even empty), Loki is reachable
      if (result.warnings?.length && result.warnings[0]?.includes('400')) {
        // Query syntax might be wrong but connection works
        return { status: 'up' };
      }
      return { status: 'up' };
    } catch {
      return { status: 'down' };
    }
  }

  private async checkSmtp(): Promise<{
    status: 'up' | 'down' | 'unconfigured';
    host?: string;
  }> {
    const smtpStatus = this.alertMailService.getStatus();
    if (!smtpStatus.enabled || !smtpStatus.configured) {
      return { status: 'unconfigured' };
    }

    const verifyResult = await this.alertMailService.verify();
    return {
      status: verifyResult.ok ? 'up' : 'down',
      host: smtpStatus.host,
    };
  }
}
