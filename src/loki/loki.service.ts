import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { LokiConfig } from '../config/loki.config';
import {
  AccessStatsResponseDto,
  BaseLokiQueryDto,
  WafStatsResponseDto,
  AccessTimeseriesResponseDto,
  GeoModeQueryDto,
  GeoStatsResponseDto,
  WafLogsQueryDto,
} from './dto/log-query.dto';
import { WafAccessLog } from '../common/interfaces/log.interface';

interface LokiResult<T> {
  data: T;
  warnings?: string[];
}

interface LokiRangeData {
  resultType: 'matrix' | 'vector' | 'streams';
  result: LokiMatrixResult[] | LokiVectorResult[] | LokiStreamResult[];
}

interface LokiMatrixResult {
  metric: Record<string, string>;
  values: Array<[number, string]>;
}

interface LokiVectorResult {
  metric: Record<string, string>;
  value: [number, string];
}

interface LokiStreamResult {
  stream: Record<string, string>;
  values: Array<[string, string]>;
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

  // --- 通用日志查询 ---

  async queryLogs(params: {
    query?: string;
    limit?: number;
    start?: number;
    end?: number;
  }): Promise<LokiResult<LokiRangeData>> {
    const query = params.query || `{job="${this.jobWaf()}"}`;
    const res = await this.client!.get<LokiResult<LokiRangeData>>(
      '/loki/api/v1/query_range',
      {
        params: {
          query,
          limit: params.limit || 100,
          start: params.start ? Math.floor(params.start * 1e6) : undefined,
          end: params.end ? Math.floor(params.end * 1e6) : undefined,
        },
      },
    );
    return res.data;
  }

  async queryWafLogs(q: WafLogsQueryDto): Promise<LokiResult<LokiRangeData>> {
    const { start, end } = this.buildTimeParams(q.timeRange);
    const labels: Record<string, string | undefined> = { host: q.server };
    if (q.action) labels.finalAction = q.action;

    const selector = this.buildLabelSelector(this.jobWaf(), labels);
    let filters = '';
    if (q.ruleId) filters += ` | json | blockRuleId="${q.ruleId}"`;
    if (q.clientIp) filters += ` | json | clientIp="${q.clientIp}"`;

    return this.queryRange({
      query: `${selector}${filters}`,
      limit: q.limit || 50,
      start: q.start ? q.start / 1000 : start,
      end: q.end ? q.end / 1000 : end,
    });
  }

  // --- 指标统计 (报表专用) ---

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

    // 审计统计通常使用 waf_logs (Security Logs)
    const selector = this.buildLabelSelector(this.jobWaf(), { host: q.server });
    const blockSelector = this.buildLabelSelector(this.jobWaf(), {
      host: q.server,
      finalAction: 'BLOCK',
    });

    const queryMap = {
      req: `sum(count_over_time(${selector}[${range}]))`,
      block: `sum(count_over_time(${blockSelector}[${range}]))`,
      type: `topk(10, sum by (finalActionType) (count_over_time(${selector}[${range}])))`,
      action: `topk(10, sum by (finalAction) (count_over_time(${selector}[${range}])))`,
      uniqueIp: `topk(100, sum by (clientIp) (count_over_time(${selector}[${range}])))`,
      attackIp: `topk(100, sum by (clientIp) (count_over_time(${blockSelector}[${range}])))`,
    };

    const time = Math.floor(end).toString();
    const [reqRes, blockRes, typeRes, actionRes, uniqueIpRes, attackIpRes] =
      await Promise.all([
        this.queryInstant({ query: queryMap.req, time }),
        this.queryInstant({ query: queryMap.block, time }),
        this.queryInstant({ query: queryMap.type, time }),
        this.queryInstant({ query: queryMap.action, time }),
        this.queryInstant({ query: queryMap.uniqueIp, time }),
        this.queryInstant({ query: queryMap.attackIp, time }),
      ]);

    const requests = this.getVectorValue(reqRes);
    const blocks = this.getVectorValue(blockRes);
    const uniqueIps = this.getVectorSeries(uniqueIpRes, 'clientIp').length;
    const attackIps = this.getVectorSeries(attackIpRes, 'clientIp').length;

    const typeSeries = this.getVectorSeries(typeRes, 'finalActionType');
    return {
      summary: {
        requests,
        blocks,
        blockRate: requests > 0 ? blocks / requests : 0,
        uniqueIps,
        attackIps,
        dynamicBlocks:
          typeSeries.find((s) => s.name === 'BLOCK_BY_DYNAMIC_BLOCK')?.count ||
          0,
        blacklistHits:
          typeSeries.find((s) => s.name === 'BLOCK_BY_IP_BLACKLIST')?.count ||
          0,
      },
      byAttackType: typeSeries.map((s) => ({ type: s.name, count: s.count })),
      byAction: this.getVectorSeries(actionRes, 'finalAction').map((s) => ({
        action: s.name,
        count: s.count,
      })),
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
    const selector = this.buildLabelSelector(this.jobAccess(), {
      host: q.server,
    });

    const queries = {
      req: `sum(count_over_time(${selector}[${range}]))`,
      block: `sum(count_over_time(${selector} | json | blocked=1[${range}]))`,
      s4xx: `sum(count_over_time(${selector} | json | status=~"4.."[${range}]))`,
      s5xx: `sum(count_over_time(${selector} | json | status=~"5.."[${range}]))`,
      hosts: `topk(10, sum by (host) (count_over_time(${selector}[${range}])))`,
      rt: `avg(avg_over_time(${selector} | json | unwrap rt[${range}]))`,
      len: `avg(avg_over_time(${selector} | json | unwrap bytes[${range}]))`, // 使用 bytes 代替 req_len
    };

    const results = await Promise.all([
      this.queryInstant({ query: queries.req, time: end.toString() }),
      this.queryInstant({ query: queries.block, time: end.toString() }),
      this.queryInstant({ query: queries.s4xx, time: end.toString() }),
      this.queryInstant({ query: queries.s5xx, time: end.toString() }),
      this.queryInstant({ query: queries.hosts, time: end.toString() }),
      this.queryInstant({ query: queries.rt, time: end.toString() }),
      this.queryInstant({ query: queries.len, time: end.toString() }),
    ]);

    const reqs = this.getVectorValue(results[0]);
    return {
      summary: {
        requests: reqs,
        blocks: this.getVectorValue(results[1]),
        uniqueIps: 0,
        status4xx: this.getVectorValue(results[2]),
        status5xx: this.getVectorValue(results[3]),
        qpsAvg: Number((reqs / (end - start)).toFixed(2)),
      },
      byHost: this.getVectorSeries(results[4], 'host').map((h) => ({
        host: h.name,
        requests: h.count,
        blocks: 0,
      })),
      byUpstreamStatus: [],
      reqLen: { avg: this.getVectorValue(results[6]), p95: 0, max: 0 },
      upRt: { avg: this.getVectorValue(results[5]), p95: 0, max: 0 },
    };
  }

  async queryAccessTimeseries(
    q: BaseLokiQueryDto,
  ): Promise<AccessTimeseriesResponseDto> {
    if (!this.client) return { intervalSeconds: 60, points: [] };
    const { start, end } = this.buildTimeParams(q.timeRange);
    const selector = this.buildLabelSelector(this.jobAccess(), {
      host: q.server,
    });
    const step = `${Math.max(1, Math.floor((end - start) / 60))}s`;

    const res = await this.queryRange({
      query: `sum(count_over_time(${selector}[$__interval]))`,
      start,
      end,
      step,
    });
    return this.aggregateAccessTimeseries(res.data, start, end);
  }

  async queryGeo(
    q: GeoModeQueryDto,
    scope: 'world' | 'china',
  ): Promise<GeoStatsResponseDto> {
    if (!this.client) return { mode: q.mode, scope, heatmap: [], top: [] };
    const { start, end } = this.buildTimeParams(q.timeRange);

    // 地理位置通常在 access_logs 中通过 GeoIP 插件注入
    const selector = this.buildLabelSelector(this.jobAccess(), {
      host: q.server,
      blocked: q.mode === 'block' ? '1' : undefined,
    });

    const res = await this.queryRange({
      query: `${selector} | json`,
      limit: 5000,
      start,
      end,
    });
    return this.aggregateGeo(res.data, q.mode, scope);
  }

  async queryWafTimeline(
    q: BaseLokiQueryDto,
  ): Promise<Array<{ ts: number; requests: number; blocks: number }>> {
    if (!this.client) return [];
    const { start, end } = this.buildTimeParams(q.timeRange);
    const duration = end - start;
    let step = '1m';
    if (duration > 3600 * 24) step = '1h';
    else if (duration > 3600) step = '5m';

    const selector = this.buildLabelSelector(this.jobWaf(), { host: q.server });
    const blockSelector = this.buildLabelSelector(this.jobWaf(), {
      host: q.server,
      finalAction: 'BLOCK',
    });

    const [reqSet, blockSet] = await Promise.all([
      this.queryRange({
        query: `sum(count_over_time(${selector}[$__interval]))`,
        start,
        end,
        step,
      }),
      this.queryRange({
        query: `sum(count_over_time(${blockSelector}[$__interval]))`,
        start,
        end,
        step,
      }),
    ]);

    return this.mergeTimeline(reqSet.data, blockSet.data);
  }

  async queryWafTopN(
    q: BaseLokiQueryDto,
    field: string,
    n = 10,
    filterBlocked = false,
  ): Promise<Array<{ name: string; count: number }>> {
    if (!this.client) return [];
    const { start, end } = this.buildTimeParams(q.timeRange);
    const range = `${Math.max(1, end - start)}s`;
    const selector = this.buildLabelSelector(
      this.jobWaf(),
      { host: q.server, finalAction: filterBlocked ? 'BLOCK' : undefined },
      [`${field}!=""`],
    );

    const res = await this.queryInstant({
      query: `topk(${n}, sum by (${field}) (count_over_time(${selector}[${range}]))`,
      time: end.toString(),
    });
    return this.getVectorSeries(res, field);
  }

  // --- Utils ---

  private buildTimeParams(timeRange: string) {
    const now = Math.floor(Date.now() / 1000);
    const value = parseInt(timeRange);
    const unit = timeRange.slice(-1);
    let start = now - 3600;
    if (unit === 'm') start = now - value * 60;
    else if (unit === 'h') start = now - value * 3600;
    else if (unit === 'd') start = now - value * 86400;
    return { start, end: now };
  }

  private buildLabelSelector(
    job: string,
    labels: Record<string, string | undefined>,
    extra: string[] = [],
  ) {
    const parts = [`job="${job}"`];
    Object.entries(labels).forEach(([k, v]) => {
      if (v) parts.push(`${k}="${v}"`);
    });
    return `{${parts.concat(extra).join(',')}}`;
  }

  private async queryInstant(params: {
    query: string;
    time: string;
  }): Promise<LokiResult<LokiRangeData>> {
    const res = await this.client!.get<LokiResult<LokiRangeData>>(
      '/loki/api/v1/query',
      { params },
    );
    return res.data;
  }

  private async queryRange(params: {
    query: string;
    limit?: number;
    start: number;
    end: number;
    step?: string;
  }): Promise<LokiResult<LokiRangeData>> {
    const { start, end, ...other } = params;
    const res = await this.client!.get<LokiResult<LokiRangeData>>(
      '/loki/api/v1/query_range',
      {
        params: {
          ...other,
          start: Math.floor(start * 1e9),
          end: Math.floor(end * 1e9),
        },
      },
    );
    return res.data;
  }

  private getVectorValue(res: LokiResult<LokiRangeData>): number {
    if (res.data.resultType === 'vector' && res.data.result.length > 0) {
      return Number((res.data.result[0] as LokiVectorResult).value[1]);
    }
    return 0;
  }

  private getVectorSeries(res: LokiResult<LokiRangeData>, labelField: string) {
    if (res.data.resultType === 'vector' && Array.isArray(res.data.result)) {
      return (res.data.result as LokiVectorResult[]).map((r) => ({
        name: r.metric[labelField] || 'unknown',
        count: Number(r.value[1]),
      }));
    }
    return [];
  }

  private jobWaf() {
    return this.cfg.jobWaf || 'waf_logs';
  }
  private jobAccess() {
    return this.cfg.jobAccess || 'access_logs';
  }

  private mergeTimeline(reqData: LokiRangeData, blockData: LokiRangeData) {
    const getPoints = (d: LokiRangeData) => {
      const map = new Map<number, number>();
      if (d?.resultType === 'matrix') {
        (d.result as LokiMatrixResult[]).forEach((s) =>
          s.values.forEach(([ts, v]) => map.set(ts, Number(v))),
        );
      }
      return map;
    };
    const reqMap = getPoints(reqData);
    const blockMap = getPoints(blockData);
    const allTs = Array.from(
      new Set([...reqMap.keys(), ...blockMap.keys()]),
    ).sort((a, b) => a - b);
    return allTs.map((ts) => ({
      ts: ts * 1000,
      requests: reqMap.get(ts) || 0,
      blocks: blockMap.get(ts) || 0,
    }));
  }

  private aggregateAccessTimeseries(
    data: LokiRangeData,
    start: number,
    end: number,
  ) {
    if (data.resultType !== 'matrix')
      return { intervalSeconds: 60, points: [] };
    const points = (data.result as LokiMatrixResult[]).flatMap((s) =>
      s.values.map(([ts, v]) => ({
        ts: ts * 1000,
        requests: Number(v),
        blocks: 0,
        latency: 0,
      })),
    );
    return { intervalSeconds: Math.floor((end - start) / 60), points };
  }

  private aggregateGeo(
    data: LokiRangeData,
    mode: 'visit' | 'block',
    scope: 'world' | 'china',
  ): GeoStatsResponseDto {
    const counts = new Map<string, number>();
    if (data.resultType === 'streams') {
      (data.result as LokiStreamResult[]).forEach((s) =>
        s.values.forEach((v) => {
          try {
            // 这里处理的是 access_logs，符合 WafAccessLog 接口
            const obj = JSON.parse(v[1]) as WafAccessLog;
            const key =
              (scope === 'world' ? obj.country : obj.province) || 'Unknown';
            counts.set(key, (counts.get(key) || 0) + 1);
          } catch (err) {
            this.logger.debug(
              `AggregateGeo parse error: ${err instanceof Error ? err.message : 'Unknown'}`,
            );
          }
        }),
      );
    }
    const list = Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    return {
      mode,
      scope,
      heatmap: list.map((i) => ({ code: i.name, count: i.count })),
      top: list.slice(0, 10),
    };
  }
}
