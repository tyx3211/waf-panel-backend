import Denque from 'denque';

/**
 * 带有时间戳的请求事件
 */
interface RequestEvent {
  ts: number;       // 毫秒时间戳
  blocked: boolean;
  status4xx: boolean;
  status5xx: boolean;
}

/**
 * 用于 Summary 统计的滑动窗口
 * 记录每个请求的基础信息，支持按时间窗口聚合
 */
export class SummaryWindowBuffer {
  private readonly queue: Denque<RequestEvent>;
  private readonly maxWindowMs: number;

  /**
   * @param maxWindowSeconds 最大窗口大小（秒），通常是7天
   */
  constructor(maxWindowSeconds: number) {
    this.queue = new Denque<RequestEvent>();
    this.maxWindowMs = maxWindowSeconds * 1000;
  }

  /**
   * 添加一个请求事件
   */
  add(tsMs: number, blocked: boolean, status: number): void {
    const now = Date.now();
    
    // 先清理超出最大窗口的旧事件
    this.evictOld(now);

    // 只接受在最大窗口内的事件（用于预填充历史数据）
    if (now - tsMs <= this.maxWindowMs) {
      this.queue.push({
        ts: tsMs,
        blocked,
        status4xx: status >= 400 && status < 500,
        status5xx: status >= 500 && status < 600,
      });
    }
  }

  /**
   * 清理超出最大窗口的事件
   */
  private evictOld(nowMs: number): void {
    const cutoff = nowMs - this.maxWindowMs;

    while (!this.queue.isEmpty()) {
      const front = this.queue.peekFront();
      if (!front || front.ts >= cutoff) break;
      this.queue.shift();
    }
  }

  /**
   * 获取指定时间窗口内的统计摘要
   */
  getSummary(windowSeconds: number, nowMs: number = Date.now()): {
    req: number;
    block: number;
    s4xx: number;
    s5xx: number;
  } {
    this.evictOld(nowMs);
    
    const cutoff = nowMs - windowSeconds * 1000;
    let req = 0, block = 0, s4xx = 0, s5xx = 0;

    // DEBUG: 检查队列的时间范围
    const qLen = this.queue.length;
    const firstTs = qLen > 0 ? this.queue.peekFront()?.ts : 0;
    const lastTs = qLen > 0 ? this.queue.peekBack()?.ts : 0;
    
    // 遍历队列（从尾部开始，因为新数据在尾部）
    for (let i = qLen - 1; i >= 0; i--) {
      const event = this.queue.peekAt(i);
      if (!event) continue;
      if (event.ts < cutoff) {
        break; // 遇到超出窗口的事件就停止
      }
      
      req++;
      if (event.blocked) block++;
      if (event.status4xx) s4xx++;
      if (event.status5xx) s5xx++;
    }
    
    // DEBUG log

    return { req, block, s4xx, s5xx };
  }

  /**
   * 获取指定时间窗口内的时序数据点
   * @param windowSeconds 时间窗口（秒）
   * @param bucketSeconds 每个数据点的时间跨度（秒）
   */
  getSeries(windowSeconds: number, bucketSeconds: number, nowMs: number = Date.now()): Array<{
    ts: number;
    req: number;
    block: number;
  }> {
    this.evictOld(nowMs);
    
    const cutoff = nowMs - windowSeconds * 1000;
    const bucketMs = bucketSeconds * 1000;
    const bucketCount = Math.ceil(windowSeconds / bucketSeconds);
    
    // 初始化桶
    const buckets: Map<number, { req: number; block: number }> = new Map();
    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = nowMs - (bucketCount - i) * bucketMs;
      buckets.set(Math.floor(bucketStart / bucketMs), { req: 0, block: 0 });
    }

    // 遍历队列统计
    const len = this.queue.length;
    for (let i = len - 1; i >= 0; i--) {
      const event = this.queue.peekAt(i);
      if (!event || event.ts < cutoff) break;
      
      const bucketKey = Math.floor(event.ts / bucketMs);
      const bucket = buckets.get(bucketKey);
      if (bucket) {
        bucket.req++;
        if (event.blocked) bucket.block++;
      }
    }

    // 转换为数组
    return Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([key, val]) => ({
        ts: key * bucketMs,
        req: val.req,
        block: val.block,
      }));
  }

  /**
   * 获取队列大小（调试用）
   */
  get size(): number {
    return this.queue.length;
  }
}
