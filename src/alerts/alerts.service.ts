import { Injectable } from '@nestjs/common';
import { OpsAuditService } from '../ops-audit/ops-audit.service';
import { OpsStatus } from '../entities/ops-audit-log.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AlertConfigEntity } from '../entities/alert-config.entity';
import { AlertSendLog } from '../entities/alert-send-log.entity';
import { AlertMailService } from './alert-mail.service';
import { AdvisoryLockService } from '../common/locks/advisory-lock.service';
import { alertLock } from '../common/locks/lock-keys';
import { WafMetricsService } from '../waf-metrics/waf-metrics.service';

export interface AlertThresholds {
  blockRate?: number;
  qps?: number;
  attackTypeCounts?: Record<string, number>;
}

export interface AlertConfig {
  enabled: boolean;
  emails: string[];
  thresholds: AlertThresholds;
  updatedBy?: string;
  updatedAt?: string;
  lastSendResult?: {
    sent: boolean;
    subject: string;
    recipients: string[];
    error?: string;
    sentAt?: string;
  };
}

@Injectable()
export class AlertsService {
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly audit: OpsAuditService,
    @InjectRepository(AlertConfigEntity)
    private readonly configRepo: Repository<AlertConfigEntity>,
    @InjectRepository(AlertSendLog)
    private readonly logRepo: Repository<AlertSendLog>,
    private readonly mail: AlertMailService,
    private readonly lock: AdvisoryLockService,
    private readonly metrics: WafMetricsService,
  ) {}

  onModuleInit() {
    // Check metrics every minute
    this.checkMetrics(); // Run immediately on startup
    this.checkInterval = setInterval(() => this.checkMetrics(), 60000);
  }

  onModuleDestroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }

  private async checkMetrics() {
    try {
      // 1. Get Config (without audit logging to reduce noise)
      const entity = await this.ensureConfig(this.configRepo);
      // Only check cooldown against SYSTEM alerts, ignore manual tests
      const last = await this.logRepo.findOne({
        where: { actor: 'system-monitor' },
        order: { createdAt: 'DESC' },
      });
      const config = this.toDto(entity, last || undefined);

      if (!config.enabled || !config.emails.length || !config.thresholds) return;

      // 2. Cooldown check (default 10 minutes to avoid spam)
      if (config.lastSendResult?.sentAt) {
        const lastSent = new Date(config.lastSendResult.sentAt).getTime();
        if (Date.now() - lastSent < 10 * 60 * 1000) return;
      }

      // 3. Get Metrics (Use 5m window for stability)
      const { summary } = this.metrics.getSummary('5m');
      // Calculate metrics
      const currentQps = summary.req / 300;
      const currentBlockRate = summary.req > 0 ? summary.block / summary.req : 0;

      const reasons: string[] = [];
      const t = config.thresholds;

      if (t.qps && currentQps > t.qps) {
        reasons.push(`QPS triggers alert: Current(${currentQps.toFixed(1)}) > Threshold(${t.qps})`);
      }
      if (t.blockRate && currentBlockRate > t.blockRate) {
        reasons.push(
          `Block Rate triggers alert: Current(${(currentBlockRate * 100).toFixed(1)}%) > Threshold(${(
            t.blockRate * 100
          ).toFixed(1)}%)`,
        );
      }

      // 4. Send Alert
      if (reasons.length > 0) {
        const subject = `[WAF Alert] Traffic Anomaly Detected`;
        const content = `Target: Web Application Firewall\nTime: ${new Date().toLocaleString()}\n\nIssues:\n${reasons.join(
          '\n',
        )}\n\nCurrent Status (Last 5m):\nTotal Requests: ${summary.req}\nBlocked Requests: ${
          summary.block
        }\n\nPlease check the dashboard for details.`;

        await this.send({ subject, content }, 'system-monitor');
      }
    } catch (err) {
      console.error('Error in checkMetrics:', err);
    }
  }

  private toDto(entity: AlertConfigEntity, last?: AlertSendLog): AlertConfig {
    return {
      enabled: entity.enabled,
      emails: entity.emails,
      thresholds: (entity.thresholds as AlertThresholds) || {},
      updatedBy: entity.updatedBy,
      updatedAt: entity.updatedAt?.toISOString(),
      lastSendResult: last
        ? {
            sent: last.sent,
            subject: last.subject,
            recipients: last.recipients,
            error: last.error,
            sentAt: last.createdAt ? last.createdAt.toISOString() : undefined,
          }
        : undefined,
    };
  }

  private async ensureConfig(
    repo: Repository<AlertConfigEntity>,
  ): Promise<AlertConfigEntity> {
    const existed = await repo.findOne({ where: {} });
    if (existed) {
      return existed;
    }
    return repo.save(
      repo.create({ enabled: true, emails: [], thresholds: {} }),
    );
  }

  async getConfig(): Promise<AlertConfig> {
    const entity = await this.ensureConfig(this.configRepo);
    const last = await this.logRepo.findOne({
      where: {},
      order: { createdAt: 'DESC' },
    });
    return this.toDto(entity, last || undefined);
  }

  async updateConfig(
    dto: Partial<AlertConfig>,
    actor?: string,
  ): Promise<AlertConfig> {
    return this.lock.withLock(alertLock(), async () => {
      return this.configRepo.manager.transaction(async (manager) => {
        const configRepo = manager.getRepository(AlertConfigEntity);
        const existed = await this.ensureConfig(configRepo);
        const mergedEntity = configRepo.merge(existed, {
          enabled: dto.enabled ?? existed.enabled,
          emails: dto.emails ?? existed.emails,
          thresholds: {
            ...(existed.thresholds || {}),
            ...(dto.thresholds || {}),
          },
          updatedBy: actor,
        });
        const saved = await configRepo.save(mergedEntity);

        await this.audit.logWithManager(manager, 'UPDATE_ALERT_CONFIG', {
          targetType: 'alert',
          targetName: 'global',
          status: 'SUCCESS' as OpsStatus,
          actor,
          detail: {
            enabled: saved.enabled,
            emails: saved.emails,
            thresholds: saved.thresholds,
          },
        });

        return this.toDto(saved);
      });
    });
  }

  async send(payload: { subject: string; content?: string }, actor?: string) {
    return this.lock.withLock(alertLock(), async () => {
      const configEntity = await this.ensureConfig(this.configRepo);
      const cfg = this.toDto(configEntity);
      const shouldSend = cfg.enabled && cfg.emails.length > 0;
      let sent = false;
      let error: string | undefined;
      if (shouldSend) {
        const result = await this.mail.send(
          cfg.emails,
          payload.subject,
          payload.content,
        );
        sent = result.sent;
        error = result.error;
      } else {
        error = '告警未发送：未开启或无收件人';
      }

      return this.logRepo.manager.transaction(async (manager) => {
        const logRepo = manager.getRepository(AlertSendLog);
        const log = logRepo.create({
          subject: payload.subject,
          content: payload.content,
          sent,
          recipients: cfg.emails,
          error: sent ? undefined : error,
          actor,
        });
        const savedLog: AlertSendLog = await logRepo.save(log);

        await this.audit.logWithManager(manager, 'SEND_ALERT', {
          targetType: 'alert',
          targetName: 'manual',
          status: sent ? ('SUCCESS' as OpsStatus) : ('FAILED' as OpsStatus),
          actor,
          detail: {
            sent,
            subject: payload.subject,
            recipients: cfg.emails,
            content: payload.content ?? '',
            error: savedLog.error ?? undefined,
          },
          note: sent ? undefined : error,
        });

        return {
          sent,
          subject: payload.subject,
          content: payload.content ?? '',
          recipients: cfg.emails,
          sentAt: savedLog.createdAt.toISOString(),
          error: savedLog.error ?? undefined,
        };
      });
    });
  }
}
