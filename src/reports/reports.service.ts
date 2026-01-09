import { Injectable } from '@nestjs/common';
import {
  WafReportSummaryDto,
  GeoEntryDto,
  GeoSectionDto,
} from './dto/waf-report.dto';
import { LokiRangeData, LokiService } from '../loki/loki.service';
import { BaseLokiQueryDto, WafLogsQueryDto } from '../loki/dto/log-query.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly loki: LokiService) {}

  async getSummary(timeRange = '24h'): Promise<WafReportSummaryDto> {
    const now = Date.now();
    const base: BaseLokiQueryDto = { timeRange };
    const wafLogsRes = await this.loki.queryWafLogsRaw(
      base as unknown as WafLogsQueryDto,
    );
    const records = this.parseStreams(wafLogsRes.data);
    const kpis = this.calcKpis(records);
    const attackTypes = this.calcAttackTypes(records);
    const timeline = this.calcTimeline(records);
    const geoWorld = this.calcGeo(records, 'world');
    const geoChina = this.calcGeo(
      records.filter((r) => r.country === 'CN'),
      'china',
    );
    const blockedRecords = records.filter((r) => r.blocked);
    const topUrls = this.topN(
      records.map((r) => r.uri).filter(Boolean) as string[],
      10,
    );
    const topAttackIps = this.topN(
      records.map((r) => r.clientIp).filter(Boolean) as string[],
      10,
    );
    const topBlockedUrls = this.topN(
      blockedRecords.map((r) => r.uri).filter(Boolean) as string[],
      10,
    );
    const topBlockedIps = this.topN(
      blockedRecords.map((r) => r.clientIp).filter(Boolean) as string[],
      10,
    );

    return {
      timeRange,
      generatedAt: new Date(now).toISOString(),
      kpis,
      timeline,
      attackTypes,
      geoWorld,
      geoChina,
      topUrls,
      topAttackIps,
      topBlockedUrls,
      topBlockedIps,
    };
  }

  getPdfBuffer(summary?: WafReportSummaryDto): Buffer {
    const payload = summary ?? {
      timeRange: '24h',
      generatedAt: new Date().toISOString(),
      kpis: {
        requests: 0,
        blocks: 0,
        uniqueIps: 0,
        attackIps: 0,
        blockRate: 0,
      },
      timeline: [],
      attackTypes: [],
      geoWorld: { mode: 'visit', scope: 'world', heatmap: [], top: [] },
      geoChina: { mode: 'block', scope: 'china', heatmap: [], top: [] },
      topUrls: [],
      topAttackIps: [],
      topBlockedUrls: [],
      topBlockedIps: [],
    };
    const textLines = [
      'WAF Report (v1)',
      `GeneratedAt: ${payload.generatedAt}`,
      `TimeRange: ${payload.timeRange}`,
      `Requests: ${payload.kpis.requests}`,
      `Blocks: ${payload.kpis.blocks}`,
      `BlockRate: ${(payload.kpis.blockRate * 100).toFixed(2)}%`,
    ];
    const body = textLines.join(' \\n ');
    const sanitized = body.replace(/\(/g, '[').replace(/\)/g, ']');
    const contentStream = `BT /F1 12 Tf 50 780 Td (${sanitized}) Tj ET`;
    const pdf = [
      '%PDF-1.4',
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
      `4 0 obj << /Length ${contentStream.length} >> stream`,
      contentStream,
      'endstream endobj',
      '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
      'xref',
      '0 6',
      '0000000000 65535 f ',
      '0000000010 00000 n ',
      '0000000060 00000 n ',
      '0000000119 00000 n ',
      '0000000263 00000 n ',
      '0000000390 00000 n ',
      'trailer << /Size 6 /Root 1 0 R >>',
      'startxref',
      '470',
      '%%EOF',
    ].join('\n');
    return Buffer.from(pdf, 'utf8');
  }

  private parseStreams(data: LokiRangeData | undefined) {
    if (!data?.result || !Array.isArray(data.result)) return [];
    const records: Array<{
      ts: number;
      attackType?: string;
      country?: string;
      uri?: string;
      clientIp?: string;
      blocked?: boolean;
    }> = [];
    const streams = data.result as unknown as Array<{
      values?: Array<[string, string]>;
    }>;
    for (const stream of streams) {
      for (const tuple of stream.values ?? []) {
        const tsNs = Number(tuple[0]);
        const ts = Number.isFinite(tsNs)
          ? Math.floor(tsNs / 1_000_000)
          : Date.now();
        const line = tuple[1];
        try {
          const parsed = JSON.parse(line) as unknown;
          const obj =
            parsed && typeof parsed === 'object'
              ? (parsed as Record<string, unknown>)
              : {};
          records.push({
            ts,
            attackType:
              typeof obj.attackType === 'string' ? obj.attackType : undefined,
            country: typeof obj.country === 'string' ? obj.country : undefined,
            uri:
              typeof obj.uri === 'string'
                ? obj.uri
                : typeof obj.path === 'string'
                  ? obj.path
                  : typeof obj.request === 'string'
                    ? obj.request
                    : undefined,
            clientIp:
              typeof obj.clientIp === 'string'
                ? obj.clientIp
                : typeof obj.remote_addr === 'string'
                  ? obj.remote_addr
                  : undefined,
            blocked:
              typeof obj.blocked === 'boolean'
                ? obj.blocked
                : obj.finalAction === 'BLOCK'
                  ? true
                  : undefined,
          });
        } catch {
          // ignore bad line
        }
      }
    }
    return records;
  }

  private calcKpis(
    records: Array<{
      ts: number;
      attackType?: string;
      clientIp?: string;
      blocked?: boolean;
    }>,
  ) {
    const requests = records.length;
    const blocks = records.filter((r) => r.blocked).length;
    const uniqueIps = new Set(records.map((r) => r.clientIp).filter(Boolean))
      .size;
    const attackIps = new Set(
      records
        .filter((r) => r.attackType)
        .map((r) => r.clientIp)
        .filter(Boolean),
    ).size;
    const blockRate = requests > 0 ? blocks / requests : 0;
    return { requests, blocks, uniqueIps, attackIps, blockRate };
  }

  private calcAttackTypes(records: Array<{ attackType?: string }>) {
    const counter = new Map<string, number>();
    for (const r of records) {
      const key = r.attackType || 'OTHER';
      counter.set(key, (counter.get(key) ?? 0) + 1);
    }
    return Array.from(counter.entries()).map(([type, count]) => ({
      type,
      count,
    }));
  }

  private calcTimeline(records: Array<{ ts: number; blocked?: boolean }>) {
    const bucket = new Map<number, { requests: number; blocks: number }>();
    for (const r of records) {
      const minute = Math.floor(r.ts / 60_000) * 60_000;
      const entry = bucket.get(minute) ?? { requests: 0, blocks: 0 };
      entry.requests += 1;
      if (r.blocked) entry.blocks += 1;
      bucket.set(minute, entry);
    }
    return Array.from(bucket.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ts, v]) => ({ ts, requests: v.requests, blocks: v.blocks }));
  }

  private calcGeo(
    records: Array<{ country?: string; blocked?: boolean }>,
    scope: 'world' | 'china',
  ): GeoSectionDto {
    const counter = new Map<string, number>();
    for (const r of records) {
      if (!r.country) continue;
      counter.set(r.country, (counter.get(r.country) ?? 0) + 1);
    }
    const heatmap: GeoEntryDto[] = Array.from(counter.entries()).map(
      ([name, count]) => ({
        name,
        count,
      }),
    );
    const top = [...heatmap].sort((a, b) => b.count - a.count).slice(0, 10);
    return { mode: 'visit', scope, heatmap, top };
  }

  private topN(items: string[], n: number): GeoEntryDto[] {
    const counter = new Map<string, number>();
    for (const i of items) {
      counter.set(i, (counter.get(i) ?? 0) + 1);
    }
    return Array.from(counter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, count]) => ({ name, count }));
  }
}
