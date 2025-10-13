import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as readline from 'readline';
import { ConfigService } from '@nestjs/config';

type SecBucket = { tsSec: number; req: number; block: number; s4xx: number; s5xx: number; pv: number; };
type MinBucket = { tsMin: number; req: number; block: number; s4xx: number; s5xx: number; pv: number; };

@Injectable()
export class WafMetricsService implements OnModuleInit, OnModuleDestroy {
  private tail?: ChildProcessWithoutNullStreams;

  private readonly secRing: SecBucket[] = Array.from({ length: 300 }, () => ({ tsSec: 0, req: 0, block: 0, s4xx: 0, s5xx: 0, pv: 0 }));
  private readonly minRing1h: MinBucket[] = Array.from({ length: 60 }, () => ({ tsMin: 0, req: 0, block: 0, s4xx: 0, s5xx: 0, pv: 0 }));
  private readonly minRing24h: MinBucket[] = Array.from({ length: 1440 }, () => ({ tsMin: 0, req: 0, block: 0, s4xx: 0, s5xx: 0, pv: 0 }));

  private pvUris: Set<string>;

  constructor(private readonly config: ConfigService) {
    const raw = (this.config.get<string>('METRICS_PV_URIS') || '').trim();
    if (raw.length > 0) {
      this.pvUris = new Set(
        raw
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      );
    } else {
      this.pvUris = new Set(['/']);
    }
  }

  onModuleInit() {
    this.tail = spawn('tail', ['-F', '/var/log/nginx/access_waf.json']);
    const rl = readline.createInterface({ input: this.tail.stdout });
    rl.on('line', (line) => this.ingestLine(line));
    this.tail.stderr.on('data', () => {
      // optional: log debug output
    });
    this.tail.on('close', () => {
      // optional: restart strategy
    });
  }

  onModuleDestroy() {
    this.tail?.kill();
  }

  private ingestLine(line: string) {
    let j: any;
    try {
      j = JSON.parse(line);
    } catch {
      return;
    }
    const tsNum = Number(j.ts);
    if (!Number.isFinite(tsNum)) return;
    const tsSec = Math.floor(tsNum);
    const tsMin = Math.floor(tsNum / 60);

    const status = Number(j.status) || 0;
    const blocked = Number(j.blocked) === 1 ? 1 : 0;
    const uri = String(j.uri || j.request_uri || '');
    const isPv = this.pvUris.has(uri) ? 1 : 0;

    const secIndex = tsSec % this.secRing.length;
    if (this.secRing[secIndex].tsSec !== tsSec) this.secRing[secIndex] = { tsSec, req: 0, block: 0, s4xx: 0, s5xx: 0, pv: 0 };
    this.secRing[secIndex].req++;
    if (blocked) this.secRing[secIndex].block++;
    if (status >= 400 && status < 500) this.secRing[secIndex].s4xx++;
    if (status >= 500 && status < 600) this.secRing[secIndex].s5xx++;
    if (isPv) this.secRing[secIndex].pv++;

    const minIndex1h = tsMin % this.minRing1h.length;
    if (this.minRing1h[minIndex1h].tsMin !== tsMin) this.minRing1h[minIndex1h] = { tsMin, req: 0, block: 0, s4xx: 0, s5xx: 0, pv: 0 };
    this.minRing1h[minIndex1h].req++;
    if (blocked) this.minRing1h[minIndex1h].block++;
    if (status >= 400 && status < 500) this.minRing1h[minIndex1h].s4xx++;
    if (status >= 500 && status < 600) this.minRing1h[minIndex1h].s5xx++;
    if (isPv) this.minRing1h[minIndex1h].pv++;

    const minIndex24h = tsMin % this.minRing24h.length;
    if (this.minRing24h[minIndex24h].tsMin !== tsMin) this.minRing24h[minIndex24h] = { tsMin, req: 0, block: 0, s4xx: 0, s5xx: 0, pv: 0 };
    this.minRing24h[minIndex24h].req++;
    if (blocked) this.minRing24h[minIndex24h].block++;
    if (status >= 400 && status < 500) this.minRing24h[minIndex24h].s4xx++;
    if (status >= 500 && status < 600) this.minRing24h[minIndex24h].s5xx++;
    if (isPv) this.minRing24h[minIndex24h].pv++;
  }

  getSeries(window: '5m' | '1h' | '24h') {
    const now = Math.floor(Date.now() / 1000);
    if (window === '5m') {
      const out: Array<{ ts: number; req: number; block: number; s4xx: number; s5xx: number; pv: number }> = [];
      for (let i = 299; i >= 0; i--) {
        const tsSec = now - i;
        const b = this.secRing[tsSec % this.secRing.length];
        out.push({
          ts: tsSec,
          req: b.tsSec === tsSec ? b.req : 0,
          block: b.tsSec === tsSec ? b.block : 0,
          s4xx: b.tsSec === tsSec ? b.s4xx : 0,
          s5xx: b.tsSec === tsSec ? b.s5xx : 0,
          pv: b.tsSec === tsSec ? b.pv : 0,
        });
      }
      return { granularity: 'sec', series: out };
    }

    const ring = window === '1h' ? this.minRing1h : this.minRing24h;
    const size = ring.length;
    const span = window === '1h' ? 60 : 1440;
    const out: Array<{ ts: number; req: number; block: number; s4xx: number; s5xx: number; pv: number }> = [];
    const nowMin = Math.floor(now / 60);
    for (let i = span - 1; i >= 0; i--) {
      const tsMin = nowMin - i;
      const b = ring[tsMin % size];
      out.push({
        ts: tsMin * 60,
        req: b.tsMin === tsMin ? b.req : 0,
        block: b.tsMin === tsMin ? b.block : 0,
        s4xx: b.tsMin === tsMin ? b.s4xx : 0,
        s5xx: b.tsMin === tsMin ? b.s5xx : 0,
        pv: b.tsMin === tsMin ? b.pv : 0,
      });
    }
    return { granularity: 'min', series: out };
  }

  getSummary(window: '5m' | '1h' | '24h') {
    const s = this.getSeries(window).series as Array<{ req: number; block: number; s4xx: number; s5xx: number; pv: number }>;
    return s.reduce(
      (acc, x) => {
        acc.req += x.req;
        acc.block += x.block;
        acc.s4xx += x.s4xx;
        acc.s5xx += x.s5xx;
        acc.pv += x.pv;
        return acc;
      },
      { req: 0, block: 0, s4xx: 0, s5xx: 0, pv: 0 },
    );
  }
}


