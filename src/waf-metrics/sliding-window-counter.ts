import Denque from 'denque';

/**
 * 带有时间戳的计数事件
 */
interface TimedEvent {
  ts: number;
  key: string;
}

/**
 * 基于 Denque 实现的滑动窗口计数器
 * - 使用双向队列高效管理事件
 * - 自动清理过期事件
 * - O(1) 的入队/出队操作
 */
export class SlidingWindowCounter {
  private readonly queue: Denque<TimedEvent>;
  private readonly counts: Map<string, number>;
  private readonly windowMs: number;

  /**
   * @param windowSeconds 滑动窗口大小（秒）
   */
  constructor(windowSeconds: number) {
    this.queue = new Denque<TimedEvent>();
    this.counts = new Map<string, number>();
    this.windowMs = windowSeconds * 1000;
  }

  /**
   * 添加一个事件
   */
  add(key: string, tsMs: number = Date.now()): void {
    // 1. 严格准入过滤 (Strict Ingest Filter):
    // 如果数据相对于"当前时间"已经过期，直接拒收。
    // 这与 Summary 的"查询时过滤"逻辑对齐，防止历史回放时旧数据污染短时间窗口。
    if (tsMs < Date.now() - this.windowMs) {
      return;
    }

    // 先清理过期事件
    this.evictExpired(tsMs);

    // 添加新事件
    this.queue.push({ ts: tsMs, key });
    this.counts.set(key, (this.counts.get(key) || 0) + 1);
  }

  /**
   * 清理过期事件（时间窗口外的事件）
   */
  private evictExpired(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;

    while (!this.queue.isEmpty()) {
      const front = this.queue.peekFront();
      if (!front || front.ts >= cutoff) break;

      // 从队列头部移除
      const expired = this.queue.shift()!;

      // 从计数器中减去
      const current = this.counts.get(expired.key) || 0;
      if (current <= 1) {
        this.counts.delete(expired.key);
      } else {
        this.counts.set(expired.key, current - 1);
      }
    }
  }

  /**
   * 获取当前窗口内的 Top N
   * @param n 返回前N个
   * @param queryWindowSeconds 查询窗口大小(秒)。如果不传或 >= 最大窗口，则返回全部缓存数据。
   * @param nowMs 当前时间戳
   */
  getTopN(n: number, queryWindowSeconds?: number, nowMs: number = Date.now()): Array<{ name: string; count: number }> {
    this.evictExpired(nowMs);

    let targetCounts = this.counts;

    // 如果指定了较小的时间窗口，需要动态聚合
    if (queryWindowSeconds && queryWindowSeconds * 1000 < this.windowMs) {
      targetCounts = this.aggregateWindow(queryWindowSeconds * 1000, nowMs);
    }

    return Array.from(targetCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  }

  /**
   * 获取所有计数（用于地理分布等需要完整数据的场景）
   */
  getAll(queryWindowSeconds?: number, nowMs: number = Date.now()): Array<{ name: string; value: number }> {
    this.evictExpired(nowMs);

    let targetCounts = this.counts;

    // 如果指定了较小的时间窗口，需要动态聚合
    if (queryWindowSeconds && queryWindowSeconds * 1000 < this.windowMs) {
      targetCounts = this.aggregateWindow(queryWindowSeconds * 1000, nowMs);
    }

    return Array.from(targetCounts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }

  /**
   * 动态聚合指定时间窗口内的数据
   */
  private aggregateWindow(windowMs: number, nowMs: number): Map<string, number> {
    const cutoff = nowMs - windowMs;
    const tempCounts = new Map<string, number>();

    // 从队列尾部（最新数据）开始遍历
    const len = this.queue.length;
    for (let i = len - 1; i >= 0; i--) {
      const event = this.queue.peekAt(i);
      if (!event || event.ts < cutoff) break; // 超出窗口，停止

      tempCounts.set(event.key, (tempCounts.get(event.key) || 0) + 1);
    }
    
    return tempCounts;
  }

  /**
   * 获取队列大小（调试用）
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * 获取当前窗口内的总计数
   */
  getTotal(nowMs: number = Date.now()): number {
    this.evictExpired(nowMs);
    let total = 0;
    for (const count of this.counts.values()) {
      total += count;
    }
    return total;
  }
}
