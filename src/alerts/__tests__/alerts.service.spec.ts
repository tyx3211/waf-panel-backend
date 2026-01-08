import { AlertsService } from '../alerts.service';
import { AlertMailService } from '../alert-mail.service';
import { Repository } from 'typeorm';
import { OpsAuditService } from '../../ops-audit/ops-audit.service';
import { OpsAuditLog } from '../../entities/ops-audit-log.entity';
import { AdvisoryLockService } from '../../common/locks/advisory-lock.service';
import { AlertConfigEntity } from '../../entities/alert-config.entity';
import { AlertSendLog } from '../../entities/alert-send-log.entity';

function createRepo<T extends { id?: number }>() {
  const store: T[] = [];
  return {
    findOne: jest.fn(async () => store[0] ?? null),
    save: jest.fn(async (e: any) => {
      if (!e.id) e.id = store.length + 1;
      if ('updatedAt' in e) e.updatedAt = new Date();
      if ('createdAt' in e) {
        e.createdAt = e.createdAt ?? new Date();
      } else {
        e.createdAt = new Date();
      }
      store[0] = e;
      return e;
    }),
    create: jest.fn((e: any) => e),
    merge: jest.fn((orig: any, patch: any) => ({ ...orig, ...patch })),
    find: jest.fn(async () => store),
  } as unknown as Repository<T>;
}

describe('AlertsService', () => {
  const audit = new OpsAuditService({} as Repository<OpsAuditLog>);
  const auditLogWithManager = jest
    .spyOn(audit, 'logWithManager')
    .mockResolvedValue(undefined);
  const configRepo = createRepo<AlertConfigEntity>();
  const logRepo = createRepo<AlertSendLog>();
  const lock = {
    withLock: jest.fn((_: string, fn: () => Promise<any>) => fn()),
  } as unknown as AdvisoryLockService;
  const manager = {
    transaction: async <T>(
      fn: (m: {
        getRepository: (
          entity: any,
        ) => Repository<AlertConfigEntity> | Repository<AlertSendLog>;
      }) => Promise<T>,
    ) =>
      fn({
        getRepository: (entity: any) =>
          entity === AlertSendLog ? logRepo : configRepo,
      }),
  };
  (configRepo as any).manager = manager;
  (logRepo as any).manager = manager;
  const mail = {
    send: jest.fn().mockResolvedValue({ sent: true }),
  };

  beforeEach(() => {
    auditLogWithManager.mockClear();
    mail.send.mockClear();
  });

  it('should update config and log audit', async () => {
    const svc = new AlertsService(
      audit,
      configRepo,
      logRepo,
      mail as unknown as AlertMailService,
      lock,
    );
    const updated = await svc.updateConfig(
      {
        enabled: false,
        emails: ['ops@example.com'],
        thresholds: { blockRate: 0.4 },
      },
      'admin',
    );
    expect(updated.enabled).toBe(false);
    expect(updated.emails).toContain('ops@example.com');
    expect(updated.thresholds.blockRate).toBe(0.4);
    expect(auditLogWithManager).toHaveBeenCalledWith(
      expect.anything(),
      'UPDATE_ALERT_CONFIG',
      expect.objectContaining({
        targetType: 'alert',
        actor: 'admin',
        status: 'SUCCESS',
      }),
    );
  });

  it('should send alert when enabled and recipients exist', async () => {
    const svc = new AlertsService(
      audit,
      configRepo,
      logRepo,
      mail as unknown as AlertMailService,
      lock,
    );
    await svc.updateConfig(
      { enabled: true, emails: ['ops@example.com'] },
      'admin',
    );
    const result = await svc.send(
      { subject: 'test', content: 'hello' },
      'admin',
    );
    expect(result.sent).toBe(true);
    expect(result.recipients).toContain('ops@example.com');
    expect(auditLogWithManager).toHaveBeenLastCalledWith(
      expect.anything(),
      'SEND_ALERT',
      expect.objectContaining({
        status: 'SUCCESS',
        detail: expect.objectContaining({ subject: 'test' }),
      }),
    );
  });

  it('should mark send failed when disabled', async () => {
    const svc = new AlertsService(
      audit,
      configRepo,
      logRepo,
      mail as unknown as AlertMailService,
      lock,
    );
    await svc.updateConfig({ enabled: false, emails: [] }, 'admin');
    const result = await svc.send({ subject: 'test' }, 'admin');
    expect(result.sent).toBe(false);
    expect(mail.send).not.toHaveBeenCalled();
    expect(auditLogWithManager).toHaveBeenLastCalledWith(
      expect.anything(),
      'SEND_ALERT',
      expect.objectContaining({ status: 'FAILED' }),
    );
  });
});
