import { Injectable } from '@nestjs/common';
import { WafReportSummaryDto } from './dto/waf-report.dto';
import { LokiService } from '../loki/loki.service';
import { BaseLokiQueryDto } from '../loki/dto/log-query.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly loki: LokiService) {}

  async getSummary(timeRange = '24h'): Promise<WafReportSummaryDto> {
    const now = Date.now();
    const base: BaseLokiQueryDto = { timeRange };

    const stats = await this.loki.queryWafStats(base);
    const timeline = await this.loki.queryWafTimeline(base);
    const topAttackIps = await this.loki.queryWafTopN(
      base,
      'clientIp',
      10,
      true,
    );
    const topBlockedUrls = await this.loki.queryWafTopN(base, 'uri', 10, true);

    // Geo Stats
    const geoWorld = await this.loki.queryGeo(
      { timeRange, mode: 'visit' },
      'world',
    );
    const geoChina = await this.loki.queryGeo(
      { timeRange, mode: 'block' },
      'china',
    );

    return {
      timeRange,
      generatedAt: new Date(now).toISOString(),
      kpis: {
        requests: stats.summary.requests,
        blocks: stats.summary.blocks,
        uniqueIps: stats.summary.uniqueIps,
        attackIps: stats.summary.attackIps,
        blockRate: stats.summary.blockRate,
      },
      timeline,
      attackTypes: stats.byAttackType,
      geoWorld,
      geoChina,
      topUrls: [], // Optional
      topAttackIps,
      topBlockedUrls,
      topBlockedIps: [], // Optional
    };
  }
}
