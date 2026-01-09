import { registerAs } from '@nestjs/config';

export interface LokiConfig {
  url: string;
  timeoutMs: number;
  maxLimit: number;
  jobWaf: string;
  jobAccess: string;
}

export default registerAs<LokiConfig>('loki', () => ({
  url: process.env.LOKI_URL || '',
  timeoutMs: process.env.LOKI_TIMEOUT_MS
    ? Number(process.env.LOKI_TIMEOUT_MS)
    : 10000,
  maxLimit: process.env.LOKI_MAX_LIMIT
    ? Number(process.env.LOKI_MAX_LIMIT)
    : 5000,
  jobWaf: process.env.LOKI_JOB_WAF || 'nginx_waf_v3',
  jobAccess: process.env.LOKI_JOB_ACCESS || 'nginx_access_v3',
}));
