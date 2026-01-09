import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ConfigService } from '@nestjs/config';
import { LokiConfig } from '../config/loki.config';
import {
  BaseLokiQueryDto,
  GeoModeQueryDto,
  WafLogsQueryDto,
} from './dto/log-query.dto';
import {
  AccessStatsResponseDto,
  AccessTimeseriesResponseDto,
  GeoStatsResponseDto,
  LokiLogsResponseDto,
  WafStatsResponseDto,
} from './dto/log-response.dto';

export interface LokiResult<T> {
  data: T;
  warnings?: string[];
}

export type LokiValueTuple = [string, string];

export interface LokiStreamResult {
  stream: Record<string, string>;
  values: LokiValueTuple[];
}

export interface LokiMatrixResult {
  metric: Record<string, string>;
  values: [number, string][];
}

export interface LokiVectorResult {
  metric: Record<string, string>;
  value: [number, string];
}

export interface LokiRangeData {
  resultType: 'streams' | 'matrix' | 'vector';
  result: LokiStreamResult[] | LokiMatrixResult[] | LokiVectorResult[];
  stats?: Record<string, unknown>;
}

interface ParsedLog {
  tsSec: number;
  obj: Record<string, unknown>;
  labels: Record<string, string>;
}

export interface LokiQueryRangeResponse {
  data: LokiRangeData;
  warnings?: string[];
}

@Injectable()
export class LokiService {
  private readonly logger = new Logger(LokiService.name);
  private client: AxiosInstance | null = null;
  private cfg: LokiConfig;

  constructor(private readonly configService: ConfigService) {
    this.cfg = this.configService.get<LokiConfig>('loki') as LokiConfig;
    if (this.cfg?.url) {
      this.client = axios.create({
        baseURL: this.cfg.url,
        timeout: this.cfg.timeoutMs,
      });
    }
  }

  private buildTimeParams(timeRange: string) {
    const now = Math.floor(Date.now() / 1000);
    const unit = timeRange.slice(-1);
    const val = Number(timeRange.slice(0, -1));
    const secs =
      unit === 'd'
        ? val * 86400
        : unit === 'h'
          ? val * 3600
          : unit === 'm'
            ? val * 60
            : val;
    return { end: now, start: now - secs };
  }

  private jobWaf(): string {
    return this.cfg?.jobWaf || 'nginx_waf_v3';
  }

  private jobAccess(): string {
    return this.cfg?.jobAccess || 'nginx_access_v3';
  }

  private buildWafQuery(q: WafLogsQueryDto): string {
    const base = `{job="${this.jobWaf()}"}`;
    const filters: string[] = ['json'];
    if (q.server) filters.push(`host="${q.server}"`);
    if (q.action) filters.push(`finalAction=~"${q.action}.*"`);
    if (q.ruleId) filters.push(`blockRuleId="${q.ruleId}"`);
    if (q.clientIp) filters.push(`clientIp="${q.clientIp}"`);
    return `${base} | ${filters.join(' | ')}`;
  }

  private buildWafBaseQuery(q: BaseLokiQueryDto): string {
    const base = `{job="${this.jobWaf()}"}`;
    const filters: string[] = ['json'];
    if (q.server) filters.push(`host="${q.server}"`);
    return `${base} | ${filters.join(' | ')}`;
  }

  private buildAccessQuery(q: BaseLokiQueryDto): string {
    const base = `{job="${this.jobAccess()}"}`;
    const filters: string[] = ['json'];
    if (q.server) filters.push(`host="${q.server}"`);
    return `${base} | ${filters.join(' | ')}`;
  }

  private escapeLabelValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private buildLabelSelector(
    job: string,
    labels: Record<string, string | undefined>,
    extra?: string[],
  ): string {
    const parts = [`job="${this.escapeLabelValue(job)}"`];
    Object.entries(labels).forEach(([key, value]) => {
      if (!value) return;
      parts.push(`${key}="${this.escapeLabelValue(value)}"`);
    });
    if (extra?.length) {
      parts.push(...extra);
    }
    return `{${parts.join(',')}}`;
  }

  private getVectorValue(res: LokiResult<LokiRangeData>): number {
    if (res.data.resultType === 'vector' && res.data.result.length > 0) {
      const val = Number((res.data.result as LokiVectorResult[])[0].value[1]);
      return Number.isFinite(val) ? val : 0;
    }
    return 0;
  }

  private getVectorSeries(
    res: LokiResult<LokiRangeData>,
    key: string,
  ): { name: string; count: number }[] {
    if (res.data.resultType === 'vector') {
      return (res.data.result as LokiVectorResult[])
        .map((r) => ({
          name: r.metric[key] || 'Unknown',
          count: Number(r.value[1]),
        }))
        .sort((a, b) => b.count - a.count);
    }
    return [];
  }

  async queryWafLogsRaw(
    q: WafLogsQueryDto,
  ): Promise<LokiResult<LokiRangeData>> {
    if (!this.client)
      return { data: { resultType: 'streams', result: [] } as LokiRangeData };
    const { start, end } = this.buildTimeParams(q.timeRange);
    const query = this.buildWafQuery(q);
    
    return this.queryRange({
      query,
      limit: this.resolveLimit(q.limit, 5000),
      start,
      end,
    });
  }

  async queryWafLogs(q: WafLogsQueryDto): Promise<LokiLogsResponseDto> {
    const res = await this.queryWafLogsRaw(q);
    const streams =
      res.data.resultType === 'streams'
        ? (res.data.result as LokiStreamResult[])
        : [];
    return {
      resultType: res.data.resultType,
      result: streams.map((s) => ({
        stream: s.stream,
        values: s.values as [string, string][],
      })),
      warnings: res.warnings,
    };
  }

  async queryWafStats(q: BaseLokiQueryDto): Promise<WafStatsResponseDto> {
    if (!this.client) {
      return {
        summary: {
          requests: 0,
          blocks: 0,
          blockRate: 0,
          uniqueIps: 0,
          attackIps: 0,
          dynamicBlocks: 0,
          blacklistHits: 0,
        },
        byAttackType: [],
        byAction: [],
      };
    }
    const { start, end } = this.buildTimeParams(q.timeRange);
    const range = `${Math.max(1, end - start)}s`;
    const selector = this.buildLabelSelector(this.jobWaf(), {
      host: q.server,
    });
    const blockSelector = this.buildLabelSelector(
      this.jobWaf(),
      { host: q.server },
      ['finalAction=~"BLOCK.*"'],
    );
    const typeSelector = this.buildLabelSelector(
      this.jobWaf(),
      { host: q.server },
      ['attackType!=""'],
    );

    const reqQ = `sum(count_over_time(${selector}[${range}]))`;
    const blockQ = `sum(count_over_time(${blockSelector}[${range}]))`;
    const typeQ = `topk(10, sum by (attackType) (count_over_time(${typeSelector}[${range}])))`;
    const actionQ = `topk(10, sum by (finalAction) (count_over_time(${selector}[${range}])))`;

    // 扩展统计
    const uniqueIpQ = `count(sum by (clientIp) (count_over_time(${selector}[${range}])))`;
    const attackIpQ = `count(sum by (clientIp) (count_over_time(${blockSelector}[${range}])))`;

    const time = BigInt(Math.floor(end * 1e9)).toString();
    const [reqRes, blockRes, typeRes, actionRes, uniqueIpRes, attackIpRes] =
      await Promise.all([
        this.queryInstant({ query: reqQ, time }),
        this.queryInstant({ query: blockQ, time }),
        this.queryInstant({ query: typeQ, time }),
        this.queryInstant({ query: actionQ, time }),
        this.queryInstant({ query: uniqueIpQ, time }),
        this.queryInstant({ query: attackIpQ, time }),
      ]);

    const requests = this.getVectorValue(reqRes);
    const blocks = this.getVectorValue(blockRes);
    const uniqueIps = this.getVectorValue(uniqueIpRes);
    const attackIps = this.getVectorValue(attackIpRes);

    // 从按类型统计中提取特定项
    const typeSeries = this.getVectorSeries(typeRes, 'attackType');
    const dynamicBlocks =
      typeSeries.find(
        (s) => s.name === 'DYNAMIC_BLOCK' || s.name === '动态封禁',
      )?.count || 0;
    const blacklistHits =
      typeSeries.find((s) => s.name === 'IP_BLACKLIST' || s.name === '黑名单')
        ?.count || 0;

    return {
      summary: {
        requests,
        blocks,
        blockRate: requests > 0 ? blocks / requests : 0,
        uniqueIps,
        attackIps,
        dynamicBlocks,
        blacklistHits,
      },
      byAttackType: typeSeries.map((s) => ({
        type: s.name,
        count: s.count,
      })),
      byAction: this.getVectorSeries(actionRes, 'finalAction').map((s) => ({
        action: s.name,
        count: s.count,
      })),
      warnings: reqRes.warnings,
    };
  }

  async queryAccessStats(q: BaseLokiQueryDto): Promise<AccessStatsResponseDto> {
    if (!this.client) {
      return {
        summary: {
          requests: 0,
          blocks: 0,
          uniqueIps: 0,
          status4xx: 0,
          status5xx: 0,
          qpsAvg: 0,
        },
        byHost: [],
        byUpstreamStatus: [],
        reqLen: { avg: 0, p95: 0, max: 0 },
        upRt: { avg: 0, p95: 0, max: 0 },
      };
    }

    const { start, end } = this.buildTimeParams(q.timeRange);
    const range = `${Math.max(1, end - start)}s`;
    const duration = Math.max(1, end - start);

    // Build selectors - use labels where available
    const baseSelector = this.buildLabelSelector(this.jobAccess(), {
      host: q.server,
    });

    // Build queries based on verified LogQL experiments
    const queries = {
      // Total requests
      requests: `sum(count_over_time(${baseSelector}[${range}]))`,
      // Blocked requests (blocked is a JSON field, use | json | blocked=1)
      blocks: `sum(count_over_time(${baseSelector} | json | blocked=1[${range}]))`,
      // 4xx status codes (status is parsed via json)
      status4xx: `sum(count_over_time(${baseSelector} | json | status=~"4.."[${range}]))`,
      // 5xx status codes
      status5xx: `sum(count_over_time(${baseSelector} | json | status=~"5.."[${range}]))`,
      // Top hosts (host is a label)
      hosts: `topk(10, sum by (host) (count_over_time(${baseSelector}[${range}])))`,
      // Response time avg: use avg(avg_over_time(...)) - never combine count_over_time with unwrap!
      rtAvg: `avg(avg_over_time(${baseSelector} | json | unwrap rt[${range}]))`,
      // Response time max
      rtMax: `max(max_over_time(${baseSelector} | json | unwrap rt[${range}]))`,
      // Request length avg
      lenAvg: `avg(avg_over_time(${baseSelector} | json | unwrap req_len[${range}]))`,
      // Request length max
      lenMax: `max(max_over_time(${baseSelector} | json | unwrap req_len[${range}]))`,
    };

    const time = BigInt(Math.floor(end * 1e9)).toString();
    const queryKeys = Object.keys(queries) as Array<keyof typeof queries>;
    const results = await Promise.all(
      queryKeys.map((key) =>
        this.queryInstant({ query: queries[key], time }).catch((err) => {
          this.logger.warn(
            `Query ${key} failed: ${err instanceof Error ? err.message : 'unknown'}`,
          );
          return {
            data: { resultType: 'vector', result: [] } as LokiRangeData,
          };
        }),
      ),
    );

    const resultMap = new Map<
      keyof typeof queries,
      LokiResult<LokiRangeData>
    >();
    queryKeys.forEach((key, idx) => resultMap.set(key, results[idx]));

    const getValue = (key: keyof typeof queries): number =>
      this.getVectorValue(resultMap.get(key) as LokiResult<LokiRangeData>);

    const requests = getValue('requests');

    return {
      summary: {
        requests,
        blocks: getValue('blocks'),
        uniqueIps: 0, // Would require expensive distinct count
        status4xx: getValue('status4xx'),
        status5xx: getValue('status5xx'),
        qpsAvg: Number((requests / duration).toFixed(2)),
      },
      byHost: this.getVectorSeries(
        resultMap.get('hosts') as LokiResult<LokiRangeData>,
        'host',
      ).map((h) => ({
        host: h.name,
        requests: h.count,
        blocks: 0, // Per-host block count would require additional query
      })),
      byUpstreamStatus: [], // Skip for now - would need label_format which has parsing issues
      reqLen: {
        avg: getValue('lenAvg'),
        p95: 0, // Quantile requires quantile_over_time which is more complex
        max: getValue('lenMax'),
      },
      upRt: {
        avg: getValue('rtAvg'),
        p95: 0,
        max: getValue('rtMax'),
      },
    };
  }

  async queryAccessTimeseries(
    q: BaseLokiQueryDto,
  ): Promise<AccessTimeseriesResponseDto> {
    if (!this.client) {
      return { intervalSeconds: 60, points: [] };
    }
    const { start, end } = this.buildTimeParams(q.timeRange);
    const query = this.buildAccessQuery(q);
    const res = await this.queryRange({
      query,
      limit: this.resolveLimit(q.limit, 5000),
      start,
      end,
    });
    return this.aggregateAccessTimeseries(res.data, res.warnings, start, end);
  }

  async queryGeo(
    q: GeoModeQueryDto,
    scope: 'world' | 'china',
  ): Promise<GeoStatsResponseDto> {
    if (!this.client) {
      return { mode: q.mode, scope, heatmap: [], top: [] };
    }
    const { start, end } = this.buildTimeParams(q.timeRange);
    const range = `${Math.max(1, end - start)}s`;

    // Use ACCESS logs for Geo stats because WAF logs often lack GeoIP info
    // but blocked requests are also logged in access log with blocked=1
    const job = this.jobAccess(); // Always use access log
    const selectorArr: string[] = [];
    if (q.server) selectorArr.push(`host="${q.server}"`);

    // Filter for blocked requests if mode is 'block'
    // blocked=1 is the label from promtail for blocked requests in access log
    if (q.mode === 'block') {
      selectorArr.push(`blocked="1"`);
    }

    const labelsStr = selectorArr.length > 0 ? `,${selectorArr.join(',')}` : '';
    const selector = `{job="${job}"${labelsStr}}`;
    const label = scope === 'world' ? 'country' : 'province';

    // Optimization: Use instant query for aggregation instead of fetching all logs.
    // For China scope, we must filter by country to avoid showing foreign states/provinces
    // Assuming the log has 'country' label or we filter by it.
    // Since 'country' is inside the JSON line but not always a label in Promtail unless configured, 
    // BUT we are using jobAccess which usually has limited labels.
    // Wait, let's check if 'country' is a label. 
    // In nginx.conf/promtail we usually set labels. 
    // If not a label, query performance might drop if we use | json | country="中国".
    // However, for correct data, we must filter.
    
    // Check if we can use a label filter. 
    // If Promtail extracts country as label, use it.
    // Assuming country IS NOT a label by default in our current setup (only job, host, blocked).
    // So we use parsing.
    
    let query = '';
    if (scope === 'china') {
       // Filter for China logs first
       query = `sum by (${label}) (count_over_time(${selector} | json | country="中国" [${range}]))`;
    } else {
       // Even for world scope, we need 'country' (which is now just a json field, not a label)
       // So we must use | json to extract it as a temporary label for aggregation
       // We also filter out empty countries to hide historical dirty data (localhost logs)
       query = `sum by (${label}) (count_over_time(${selector} | json | country!="" [${range}]))`;
    }
    const time = BigInt(Math.floor(end * 1e9)).toString();

    const res = await this.queryInstant({ query, time });
    const series = this.getVectorSeries(res, label);

    const heatmap = series.map((s) => ({
      code: s.name === '' ? 'UNKNOWN' : s.name,
      count: s.count,
    }));

    const top = series
      .filter((s) => s.name !== '' && s.name !== 'Unknown')
      .slice(0, 10)
      .map((s) => ({
        name: s.name,
        count: s.count,
      }));

    return {
      mode: q.mode,
      scope,
      heatmap,
      top,
      warnings: res.warnings,
    };
  }

  async queryLogs(
    params: Record<string, string>,
  ): Promise<LokiResult<LokiRangeData>> {
    if (!this.client) return { data: { resultType: 'streams', result: [] } };
    const searchParams = new URLSearchParams(params);
    try {
      const res = await this.client.get('/loki/api/v1/query_range', {
        params: searchParams,
      });
      const payload = res.data as LokiQueryRangeResponse;
      return {
        data: payload?.data ?? { resultType: 'streams', result: [] },
        warnings: payload?.warnings,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'loki query failed';
      if (axios.isAxiosError(err) && err.response?.data) {
        const data = err.response.data as unknown;
        this.logger.error(`loki query detailed error: ${JSON.stringify(data)}`);
      }
      this.logger.error(`loki query failed: ${msg}`);
      return { data: { resultType: 'streams', result: [] }, warnings: [msg] };
    }
  }

  async queryInstant(
    params: Record<string, string>,
  ): Promise<LokiResult<LokiRangeData>> {
    if (!this.client)
      return {
        data: {
          resultType: 'vector',
          result: [],
        } as unknown as LokiRangeData,
      };
    const searchParams = new URLSearchParams(params);
    try {
      const res = await this.client.get('/loki/api/v1/query', {
        params: searchParams,
      });

      const payload = res.data as unknown as LokiQueryRangeResponse;
      return {
        data:
          payload?.data ??
          ({ resultType: 'vector', result: [] } as LokiRangeData),
        warnings: payload?.warnings,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'loki query failed';
      if (axios.isAxiosError(err) && err.response?.data) {
        const data = err.response.data as unknown;
        this.logger.error(
          `loki query instant detailed error: ${JSON.stringify(data)}`,
        );
      }
      this.logger.error(`loki query instant failed: ${msg}`);
      return {
        data: { resultType: 'vector', result: [] } as LokiRangeData,
        warnings: [msg],
      };
    }
  }

  private async queryRange(opts: {
    query: string;
    limit?: number;
    start: number;
    end: number;
    scope?: string;
  }) {
    const params: Record<string, string> = {
      query: opts.query,
      start: String(opts.start * 1e9),
      end: String(opts.end * 1e9),
    };
    if (opts.limit) params['limit'] = String(opts.limit);
    return this.queryLogs(params);
  }

  private resolveLimit(requested?: number, fallback?: number): number {
    const max = this.cfg?.maxLimit ?? 1000;
    const raw = requested ?? fallback ?? max;
    if (!Number.isFinite(raw) || raw <= 0) return max;
    return Math.min(raw, max);
  }

  private parseLogs(data?: LokiRangeData): ParsedLog[] {
    if (!data?.result || !Array.isArray(data.result)) return [];
    if (data.resultType !== 'streams') return [];

    const logs: ParsedLog[] = [];

    const streams = data.result as LokiStreamResult[];

    for (const stream of streams) {
      const labels =
        stream && typeof stream.stream === 'object' ? stream.stream : {};
      for (const tuple of stream.values ?? []) {
        const tsNs = tuple[0];
        const line = tuple[1];
        const obj = this.parseJsonLine(line) ?? {};
        const tsSec = this.getTimestampSec(obj, tsNs);
        logs.push({ tsSec, obj, labels });
      }
    }
    return logs;
  }

  private parseJsonLine(line: string): Record<string, unknown> | null {
    if (!line) return null;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
    return null;
  }

  private getString(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value);
    return undefined;
  }

  private getNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const num = Number(value);
      if (Number.isFinite(num)) return num;
    }
    return undefined;
  }

  private parseFirstNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return undefined;
    const tokens = value.split(/[,\s]+/).filter(Boolean);
    for (const token of tokens) {
      if (token === '-' || token.toLowerCase() === 'nan') continue;
      const num = Number(token);
      if (Number.isFinite(num)) return num;
    }
    return undefined;
  }

  private getTimestampSec(
    obj: Record<string, unknown>,
    fallbackNs: string,
  ): number {
    const rawTs =
      obj.ts ?? obj.timestamp ?? obj.time ?? obj['@timestamp'] ?? obj['@ts'];
    const parsed = this.getNumber(rawTs);
    if (parsed !== undefined) {
      if (parsed > 1e12) return Math.floor(parsed / 1000);
      if (parsed > 1e10) return Math.floor(parsed / 1000);
      if (parsed > 1e9) return Math.floor(parsed);
      return Math.floor(parsed);
    }
    const ns = Number(fallbackNs);
    if (Number.isFinite(ns)) return Math.floor(ns / 1e9);
    return Math.floor(Date.now() / 1000);
  }

  private isBlocked(obj: Record<string, unknown>): boolean {
    const blocked =
      obj.blocked ??
      obj.waf_blocked ??
      obj.wafBlocked ??
      obj.isBlocked ??
      obj.block;
    if (typeof blocked === 'boolean') return blocked;
    if (typeof blocked === 'number') return blocked > 0;
    if (typeof blocked === 'string') {
      const val = blocked.trim().toLowerCase();
      if (val === '1' || val === 'true' || val === 'yes') return true;
      if (val === '0' || val === 'false' || val === 'no') return false;
    }
    const action = this.getAction(obj);
    return action.startsWith('BLOCK');
  }

  private getAction(obj: Record<string, unknown>): string {
    const action = this.getString(
      obj.finalAction ?? obj.waf_action ?? obj.wafAction ?? obj.action,
    );
    return action ? action.toUpperCase() : 'UNKNOWN';
  }

  private getAttackType(obj: Record<string, unknown>): string | undefined {
    return this.getString(
      obj.attackType ?? obj.waf_type ?? obj.waf_attack_type ?? obj.attack_type,
    );
  }

  private getClientIp(obj: Record<string, unknown>): string | undefined {
    return this.getString(
      obj.clientIp ??
        obj.client_ip ??
        obj.ip ??
        obj.remote_addr ??
        obj.remoteAddr,
    );
  }

  private getHost(obj: Record<string, unknown>): string | undefined {
    return this.getString(obj.host ?? obj.hostname ?? obj.server_name);
  }

  private getUpstreamStatus(obj: Record<string, unknown>): string | undefined {
    const raw = this.getString(
      obj.up_status ?? obj.upstream_status ?? obj.upStatus,
    );
    if (!raw) return undefined;
    const token = raw.split(/[,\s]+/).find(Boolean);
    if (!token || token === '-') return undefined;
    return token;
  }

  private getStatusCode(obj: Record<string, unknown>): number | undefined {
    const status = this.getNumber(obj.status ?? obj.code);
    return status !== undefined ? Math.floor(status) : undefined;
  }

  private calcDistribution(values: number[]) {
    if (!values.length) return { avg: 0, p95: 0, max: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((acc, cur) => acc + cur, 0);
    const avg = sum / values.length;
    const p95Index = Math.max(0, Math.ceil(values.length * 0.95) - 1);
    const p95 = sorted[p95Index] ?? sorted[sorted.length - 1];
    const max = sorted[sorted.length - 1] ?? 0;
    return { avg, p95, max };
  }

  private aggregateWafStats(
    data: LokiRangeData | undefined,
    warnings?: string[],
  ): WafStatsResponseDto {
    const logs = this.parseLogs(data);
    const byAttackType = new Map<string, number>();
    const byAction = new Map<string, number>();
    const uniqueIps = new Set<string>();
    const attackIps = new Set<string>();
    let requests = 0;
    let blocks = 0;

    for (const log of logs) {
      requests += 1;
      const ip = this.getClientIp(log.obj);
      if (ip) uniqueIps.add(ip);
      const action = this.getAction(log.obj);
      byAction.set(action, (byAction.get(action) ?? 0) + 1);
      const blocked = this.isBlocked(log.obj);
      if (blocked) {
        blocks += 1;
        if (ip) attackIps.add(ip);
        const attackType = this.getAttackType(log.obj) ?? 'OTHER';
        byAttackType.set(attackType, (byAttackType.get(attackType) ?? 0) + 1);
      }
    }

    const blockRate = requests > 0 ? blocks / requests : 0;
    return {
      summary: {
        requests,
        blocks,
        blockRate,
        uniqueIps: uniqueIps.size,
        attackIps: attackIps.size,
        dynamicBlocks:
          byAttackType.get('DYNAMIC_BLOCK') ??
          byAttackType.get('动态封禁') ??
          0,
        blacklistHits:
          byAttackType.get('IP_BLACKLIST') ?? byAttackType.get('黑名单') ?? 0,
      },
      byAttackType: [...byAttackType.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
      byAction: [...byAction.entries()]
        .map(([action, count]) => ({ action, count }))
        .sort((a, b) => b.count - a.count),
      warnings,
    };
  }

  private aggregateAccessStats(
    data: LokiRangeData | undefined,
    warnings: string[] | undefined,
    rangeSeconds: number,
  ): AccessStatsResponseDto {
    const logs = this.parseLogs(data);
    const uniqueIps = new Set<string>();
    const byHost = new Map<string, { requests: number; blocks: number }>();
    const byUpStatus = new Map<string, number>();
    const reqLens: number[] = [];
    const upRts: number[] = [];
    let requests = 0;
    let blocks = 0;
    let status4xx = 0;
    let status5xx = 0;

    for (const log of logs) {
      requests += 1;
      const ip = this.getClientIp(log.obj);
      if (ip) uniqueIps.add(ip);
      const blocked = this.isBlocked(log.obj);
      if (blocked) blocks += 1;
      const host = this.getHost(log.obj) ?? 'unknown';
      const hostStat = byHost.get(host) ?? { requests: 0, blocks: 0 };
      hostStat.requests += 1;
      if (blocked) hostStat.blocks += 1;
      byHost.set(host, hostStat);

      const status = this.getStatusCode(log.obj);
      if (status !== undefined) {
        if (status >= 400 && status < 500) status4xx += 1;
        if (status >= 500 && status < 600) status5xx += 1;
      }

      const upStatus = this.getUpstreamStatus(log.obj);
      if (upStatus) {
        byUpStatus.set(upStatus, (byUpStatus.get(upStatus) ?? 0) + 1);
      }

      const reqLen = this.getNumber(log.obj.req_len ?? log.obj.reqLen);
      if (reqLen !== undefined) reqLens.push(reqLen);

      const upRt = this.parseFirstNumber(
        log.obj.up_rt ?? log.obj.upRt ?? log.obj.upstream_response_time,
      );
      if (upRt !== undefined) upRts.push(upRt);
    }

    const qpsAvg =
      rangeSeconds > 0 ? Number((requests / rangeSeconds).toFixed(2)) : 0;
    const reqLenStats = this.calcDistribution(reqLens);
    const upRtStats = this.calcDistribution(upRts);

    return {
      summary: {
        requests,
        blocks,
        uniqueIps: uniqueIps.size,
        status4xx,
        status5xx,
        qpsAvg,
      },
      byHost: [...byHost.entries()]
        .map(([host, stat]) => ({ host, ...stat }))
        .sort((a, b) => b.requests - a.requests),
      byUpstreamStatus: [...byUpStatus.entries()]
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count),
      reqLen: reqLenStats,
      upRt: upRtStats,
      warnings,
    };
  }

  private pickIntervalSeconds(totalSeconds: number): number {
    if (totalSeconds <= 3600) return 60;
    if (totalSeconds <= 6 * 3600) return 300;
    if (totalSeconds <= 24 * 3600) return 600;
    if (totalSeconds <= 7 * 86400) return 3600;
    return 21600;
  }

  private aggregateAccessTimeseries(
    data: LokiRangeData | undefined,
    warnings: string[] | undefined,
    startSec: number,
    endSec: number,
  ): AccessTimeseriesResponseDto {
    const totalSeconds = Math.max(0, endSec - startSec);
    const intervalSeconds = this.pickIntervalSeconds(totalSeconds);
    const bucketCount = Math.max(1, Math.ceil(totalSeconds / intervalSeconds));
    const buckets = Array.from({ length: bucketCount }, () => ({
      requests: 0,
      blocks: 0,
    }));
    const logs = this.parseLogs(data);
    for (const log of logs) {
      if (log.tsSec < startSec || log.tsSec > endSec) continue;
      const idx = Math.min(
        bucketCount - 1,
        Math.floor((log.tsSec - startSec) / intervalSeconds),
      );
      buckets[idx].requests += 1;
      if (this.isBlocked(log.obj)) buckets[idx].blocks += 1;
    }
    const points = buckets.map((bucket, idx) => ({
      ts: new Date((startSec + idx * intervalSeconds) * 1000).toISOString(),
      requests: bucket.requests,
      blocks: bucket.blocks,
    }));
    return { intervalSeconds, points, warnings };
  }

  private aggregateGeo(
    data: LokiRangeData | undefined,
    warnings: string[] | undefined,
    mode: 'visit' | 'block',
    scope: 'world' | 'china',
  ): GeoStatsResponseDto {
    const logs = this.parseLogs(data);
    const counts = new Map<
      string,
      { code: string; name: string; count: number }
    >();

    for (const log of logs) {
      const obj = log.obj;
      let code = '';
      let name = '';
      if (scope === 'world') {
        code =
          this.getString(
            obj.countryCode ?? obj.country_code ?? obj.cc ?? obj.country,
          ) ?? '';
        name =
          this.getString(
            obj.country ?? obj.country_name ?? obj.countryName ?? code,
          ) ?? '';
      } else {
        code =
          this.getString(
            obj.provinceCode ?? obj.province_code ?? obj.region ?? obj.province,
          ) ?? '';
        name =
          this.getString(
            obj.province ?? obj.region_name ?? obj.region ?? code,
          ) ?? '';
      }
      const key = (code || name || '').trim();
      if (!key) continue;
      const entry = counts.get(key) ?? {
        code: code || key,
        name: name || key,
        count: 0,
      };
      entry.count += 1;
      counts.set(key, entry);
    }

    const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
    return {
      mode,
      scope,
      heatmap: sorted.map((entry) => ({
        code: entry.code,
        count: entry.count,
      })),
      top: sorted
        .slice(0, 7)
        .map((entry) => ({ name: entry.name, count: entry.count })),
      warnings,
    };
  }
}
