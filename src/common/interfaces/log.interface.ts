/**
 * WAF 访问日志接口 (对应 access_waf.jsonl)
 * 由 Nginx log_format 生成，通常用于统计 QPS、拦截率、TopN IP 等指标。
 */
export interface WafAccessLog {
  ts: string; // "%unix_timestamp"
  ip: string; // "%remote_addr"
  method: string; // "%request_method"
  uri: string; // "%request_uri"
  status: number; // "%status"
  bytes: number; // "%body_bytes_sent"
  rt: number; // "%request_time"
  ua: string; // "%http_user_agent"
  ref: string; // "%http_referer"
  blocked: number; // WAF 阻断标记 (0|1)
  waf_action: string; // WAF 执行动作 (ALLOW|BLOCK|BYPASS)
  waf_rule: string; // 触发的规则 ID
  waf_type: string; // 阻断原因类型
  // 额外扩展字段 (Loki 解析可能产生的字段)
  country?: string;
  province?: string;
  city?: string;
  clientIp?: string;
  remote_addr?: string;
  request_uri?: string;
  attackType?: string;
  finalAction?: string;
}

/**
 * WAF 安全事件详情接口 (对应 waf.jsonl)
 * 遵循 WAF 请求日志 JSONL 规范 v2.0，面向安全人员进行详细审计。
 */
export interface WafSecurityLog {
  time: string; // UTC ISO8601 (%Y-%m-%dT%H:%M:%SZ)
  clientIp: string; // 客户端 IP
  method: string; // HTTP 方法
  host: string; // HTTP Host 头
  uri: string; // 请求 URI
  status: number; // HTTP 状态码
  finalAction: 'BLOCK' | 'BYPASS' | 'ALLOW'; // 最终动作
  finalActionType: string; // 动作类型 (如 BLOCK_BY_RULE)
  currentGlobalAction: string; // 当前全局策略 (BLOCK|LOG)
  blockRuleId?: number; // 阻断规则 ID
  level: 'DEBUG' | 'INFO' | 'ALERT' | 'ERROR' | 'NONE'; // 日志级别
  events: WafSecurityLogEvent[]; // 事件数组 (规则命中明细)
}

export interface WafSecurityLogEvent {
  type: 'rule' | 'reputation' | 'ban' | 'reputation_window_reset';
  decisive?: boolean; // 是否为决定性事件
  // Rule 事件字段
  ruleId?: number;
  intent?: 'BLOCK' | 'LOG' | 'BYPASS';
  scoreDelta?: number;
  totalScore?: number;
  target?: string;
  matchedPattern?: string;
  patternIndex?: number;
  negate?: boolean;
  // Ban 字段
  window?: number; // 封禁时长 (ms)
  // Reputation Window Reset 字段
  prevScore?: number;
  windowStartMs?: number;
  windowEndMs?: number;
  reason?: string;
  category?: string;
}
