import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ConfigService } from '@nestjs/config';
import { LokiConfig } from '../config/loki.config';
import {
  BaseLokiQueryDto,
  GeoModeQueryDto,
  WafLogsQueryDto,
} from './dto/log-query.dto';

export interface LokiResult<T> {
  data: T;
  warnings?: string[];
}

export interface LokiValueTuple {
  0: string; // nanosecond timestamp
  1: string; // line content
}

export interface LokiStreamResult {
  stream: Record<string, string>;
  values: LokiValueTuple[];
}

export interface LokiRangeData {
  resultType: string;
  result: LokiStreamResult[];
  stats?: Record<string, unknown>;
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
    const secs = unit === 'h' ? val * 3600 : unit === 'm' ? val * 60 : val;
    return { end: now, start: now - secs };
  }

  private jobWaf(): string {
    return this.cfg?.jobWaf || 'nginx_waf';
  }

  private jobAccess(): string {
    return this.cfg?.jobAccess || 'nginx_access';
  }

  private buildWafQuery(q: WafLogsQueryDto): string {
    const base = `{job="${this.jobWaf()}"}`;
    const filters: string[] = ['json'];
    if (q.server) filters.push(`host="${q.server}"`);
    if (q.action) filters.push(`finalAction="${q.action}"`);
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

  async queryWafLogs(q: WafLogsQueryDto): Promise<LokiResult<LokiRangeData>> {
    if (!this.client)
      return { data: { resultType: 'streams', result: [] } as LokiRangeData };
    const { start, end } = this.buildTimeParams(q.timeRange);
    const query = this.buildWafQuery(q);
    return this.queryRange({ query, limit: q.limit, start, end });
  }

  async queryWafStats(q: BaseLokiQueryDto): Promise<LokiResult<LokiRangeData>> {
    if (!this.client) return { data: { resultType: 'streams', result: [] } };
    const { start, end } = this.buildTimeParams(q.timeRange);
    const query = `${this.buildWafBaseQuery(q)} | unwrap waf_attack_type | count_over_time(1m)`;
    return this.queryRange({ query, limit: q.limit, start, end });
  }

  async queryAccessStats(
    q: BaseLokiQueryDto,
  ): Promise<LokiResult<LokiRangeData>> {
    if (!this.client) return { data: { resultType: 'streams', result: [] } };
    const { start, end } = this.buildTimeParams(q.timeRange);
    const query = `${this.buildAccessQuery(q)} | count_over_time(1m)`;
    return this.queryRange({ query, limit: q.limit, start, end });
  }

  async queryAccessTimeseries(
    q: BaseLokiQueryDto,
  ): Promise<LokiResult<LokiRangeData>> {
    if (!this.client) return { data: { resultType: 'streams', result: [] } };
    const { start, end } = this.buildTimeParams(q.timeRange);
    const query = `${this.buildAccessQuery(q)} | unwrap req_len`;
    return this.queryRange({ query, limit: q.limit, start, end });
  }

  async queryGeo(
    q: GeoModeQueryDto,
    scope: 'world' | 'china',
  ): Promise<LokiResult<LokiRangeData>> {
    if (!this.client) return { data: { resultType: 'streams', result: [] } };
    const { start, end } = this.buildTimeParams(q.timeRange);
    const job = q.mode === 'block' ? this.jobWaf() : this.jobAccess();
    const base = `{job="${job}"}`;
    const filters: string[] = ['json'];
    if (q.server) filters.push(`host="${q.server}"`);
    const query = `${base} | ${filters.join(' | ')} | unwrap country | count_over_time(5m)`;
    return this.queryRange({ query, limit: q.limit, start, end, scope });
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
      this.logger.error(`loki query failed: ${msg}`);
      return { data: { resultType: 'streams', result: [] }, warnings: [msg] };
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
}
