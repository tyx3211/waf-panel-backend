import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as readline from 'readline';
import * as fs from 'fs';
import {
  WafSummaryResponseDto,
  WafGeoResponseDto,
  WafTopResponseDto,
} from './dto/waf-metrics.dto';
import { WafAccessLog } from '../common/interfaces/log.interface';
import { SlidingWindowCounter } from './sliding-window-counter';
import { SummaryWindowBuffer } from './summary-window-buffer';

// Default window for Top stats: 24 hours
const TOP_WINDOW_SECONDS = 24 * 60 * 60;
// Default window for Geo stats: 7 days
const GEO_WINDOW_SECONDS = 7 * 24 * 60 * 60;
// Max window for Summary: 7 days (covers all time ranges)
const SUMMARY_MAX_WINDOW_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class WafMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WafMetricsService.name);
  private tail?: ChildProcessWithoutNullStreams;
  private isReady = false;

  // 使用 SummaryWindowBuffer 保持不变，用于 Summary 统计
  private readonly summaryBuffer = new SummaryWindowBuffer(SUMMARY_MAX_WINDOW_SECONDS);

  // 为每个时间范围维护独立的计数器组，确保绝对的数据隔离和 O(1) 查询
  private readonly counters: Map<string, {
    topIps: SlidingWindowCounter;
    topUrls: SlidingWindowCounter;
    attackTypes: SlidingWindowCounter;
    
    geoWorldVisit: SlidingWindowCounter;
    geoWorldBlock: SlidingWindowCounter;
    geoChinaVisit: SlidingWindowCounter;
    geoChinaBlock: SlidingWindowCounter;
  }> = new Map();

  private readonly LOG_PATH = '/usr/local/nginx/logs/access_waf.jsonl';

  constructor() {
    this.initializeCounters();
  }

  private initializeCounters() {
    const ranges: Array<'5m' | '1h' | '24h' | '7d'> = ['5m', '1h', '24h', '7d'];
    
    for (const range of ranges) {
      const windowSeconds = this.rangeToSeconds(range);
      this.counters.set(range, {
        topIps: new SlidingWindowCounter(windowSeconds),
        topUrls: new SlidingWindowCounter(windowSeconds),
        attackTypes: new SlidingWindowCounter(windowSeconds),
        
        geoWorldVisit: new SlidingWindowCounter(windowSeconds),
        geoWorldBlock: new SlidingWindowCounter(windowSeconds),
        geoChinaVisit: new SlidingWindowCounter(windowSeconds),
        geoChinaBlock: new SlidingWindowCounter(windowSeconds),
      });
    }
  }

  onModuleInit() {
    this.logger.log('Initializing WAF Metrics (Async)...');
    setImmediate(() => {
      const init = async () => {
        try {
          await this.prePopulate();
          this.startTail();
        } catch (err) {
          this.logger.error(
            `Metrics initialization failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
      };
      void init();
    });
    this.isReady = true;
    this.logger.log('WAF Metrics Service initialization scheduled.');
  }

  onModuleDestroy() {
    if (this.tail) {
      this.tail.kill();
    }
  }

  private async prePopulate() {
    if (!fs.existsSync(this.LOG_PATH)) return;

    this.logger.log(`Pre-populating metrics from ${this.LOG_PATH}...`);
    const fileStream = fs.createReadStream(this.LOG_PATH);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let count = 0;
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const log = JSON.parse(line) as WafAccessLog;
        this.ingest(log);
        count++;
      } catch (err) {
        this.logger.debug(
          `Failed to parse historical log line: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      }
    }
    this.logger.log(
      `Pre-population complete. Processed ${count} historical logs.`,
    );
  }

  private startTail() {
    this.tail = spawn('tail', ['-n', '0', '-F', this.LOG_PATH]);
    const rl = readline.createInterface({ input: this.tail.stdout });

    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const log = JSON.parse(line) as WafAccessLog;
        this.ingest(log);
      } catch (err) {
        this.logger.debug(
          `Failed to parse real-time log line: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      }
    });

    this.tail.on('close', () => {
      if (this.isReady) {
        setTimeout(() => this.startTail(), 5000);
      }
    });
  }

  private ingest(j: WafAccessLog) {
    const ts = Number(j.ts) || Date.now() / 1000;
    const tsMs = ts * 1000;
    const status = Number(j.status) || 0;
    
    // Determine if it counts as an attack (Blocked OR Rule Triggered)
    const blocked = Number(j.blocked) === 1;
    const ruleTriggered = !!(j.waf_rule && j.waf_rule !== '');
    const isAttack = blocked || ruleTriggered;

    // 1. 更新 Summary (所有请求)
    this.summaryBuffer.add(tsMs, blocked, status);

    const ip = j.ip || j.clientIp || j.remote_addr;
    const uri = j.uri || j.request_uri;
    const attackType = j.waf_type || j.attackType;
    const country = j.country;
    const province = j.province;

    // 2. 更新各个时间窗口的 Counters
    this.counters.forEach((group) => {
      // General Visit Stats (无论是否拦截，只有有国家信息就计入 Visit)
      if (country) group.geoWorldVisit.add(country, tsMs);
      if (province && j.country === '中国') group.geoChinaVisit.add(province, tsMs);

      // Attack Stats (只计入攻击请求)
      if (isAttack) {
        if (ip) group.topIps.add(ip, tsMs);
        if (uri) group.topUrls.add(uri, tsMs); // 这里的 Top URL 是"被攻击的URL"
        if (attackType) group.attackTypes.add(attackType, tsMs);
        
        if (country) group.geoWorldBlock.add(country, tsMs);
        if (province && j.country === '中国') group.geoChinaBlock.add(province, tsMs);
      }
    });
  }

  getSummary(range: '5m' | '1h' | '24h' | '7d'): WafSummaryResponseDto {
    const now = Date.now();
    let windowSeconds: number;
    let bucketSeconds: number;
    
    if (range === '5m') {
      windowSeconds = 5 * 60;
      bucketSeconds = 1;
    } else if (range === '1h') {
      windowSeconds = 60 * 60;
      bucketSeconds = 60;
    } else if (range === '24h') {
      windowSeconds = 24 * 60 * 60;
      bucketSeconds = 60;
    } else {
      windowSeconds = 7 * 24 * 60 * 60;
      bucketSeconds = 3600;
    }

    const summary = this.summaryBuffer.getSummary(windowSeconds, now);
    const series = this.summaryBuffer.getSeries(windowSeconds, bucketSeconds, now);

    return {
      summary,
      series,
    };
  }

  getTopStats(range: '5m' | '1h' | '24h' | '7d' = '24h'): WafTopResponseDto {
    const now = Date.now();
    const group = this.counters.get(range) || this.counters.get('24h')!;
    
    return {
      topIps: group.topIps.getTopN(10), // 使用无参调用（或只传N），内部已是正确数据
      topUrls: group.topUrls.getTopN(10),
      attackTypes: group.attackTypes.getTopN(10),
    };
  }

  getGeoStats(range: '5m' | '1h' | '24h' | '7d' = '7d', mode: 'visit' | 'block' = 'visit'): WafGeoResponseDto {
    const now = Date.now();
    const group = this.counters.get(range) || this.counters.get('7d')!;
    
    if (mode === 'block') {
      return {
        world: group.geoWorldBlock.getAll(),
        china: group.geoChinaBlock.getAll(),
      };
    } else {
      return {
        world: group.geoWorldVisit.getAll(),
        china: group.geoChinaVisit.getAll(),
      };
    }
  }

  private rangeToSeconds(range: '5m' | '1h' | '24h' | '7d'): number {
    switch (range) {
      case '5m': return 5 * 60;
      case '1h': return 60 * 60;
      case '24h': return 24 * 60 * 60;
      case '7d': return 7 * 24 * 60 * 60;
      default: return 24 * 60 * 60;
    }
  }
}
