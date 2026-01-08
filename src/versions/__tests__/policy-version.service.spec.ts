import { PolicyVersionService } from '../policy-version.service';
import { AdvisoryLockService } from '../../common/locks/advisory-lock.service';
import { OpsAuditService } from '../../ops-audit/ops-audit.service';
import { Repository } from 'typeorm';
import { ServerPolicyVersion } from '../../entities/server-policy-version.entity';
import { serverLock } from '../../common/locks/lock-keys';

class FakeRepo {
  store: ServerPolicyVersion[] = [];
  manager = {
    transaction: async <T>(
      fn: (manager: { getRepository: () => FakeRepo }) => Promise<T>,
    ) => fn({ getRepository: () => this }),
  };

  async find(options: any): Promise<ServerPolicyVersion[]> {
    if (options?.where?.serverName) {
      return this.store
        .filter((v) => v.serverName === options.where.serverName)
        .sort((a, b) =>
          options.order?.versionNo === 'DESC'
            ? b.versionNo - a.versionNo
            : a.versionNo - b.versionNo,
        );
    }
    return this.store;
  }

  async findOne(options: any): Promise<ServerPolicyVersion | null> {
    if (!options?.where?.serverName) return null;
    const matched = this.store
      .filter((v) => v.serverName === options.where.serverName)
      .sort((a, b) =>
        options.order?.versionNo === 'DESC'
          ? b.versionNo - a.versionNo
          : a.versionNo - b.versionNo,
      );
    if (options.where.versionNo !== undefined) {
      return (
        matched.find((v) => v.versionNo === options.where.versionNo) ?? null
      );
    }
    return matched[0] ?? null;
  }

  create(data: Partial<ServerPolicyVersion>): ServerPolicyVersion {
    return {
      id: this.store.length + 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    } as ServerPolicyVersion;
  }

  async save(entity: ServerPolicyVersion): Promise<ServerPolicyVersion> {
    const existing = this.store.find((v) => v.id === entity.id);
    if (existing) {
      Object.assign(existing, entity);
      return existing;
    }
    this.store.push(entity);
    return entity;
  }
}

describe('PolicyVersionService', () => {
  let repo: FakeRepo;
  let lockSpy: jest.SpyInstance;
  let auditEntries: any[];
  let service: PolicyVersionService;

  beforeEach(() => {
    repo = new FakeRepo();
    auditEntries = [];
    const lock = {
      withLock: jest.fn((key: string, fn: () => Promise<any>) => fn()),
    } as unknown as AdvisoryLockService;
    lockSpy = jest.spyOn(lock, 'withLock');
    const audit = {
      logWithManager: jest.fn((_, actionType, payload) =>
        auditEntries.push({ actionType, payload }),
      ),
    } as unknown as OpsAuditService;
    service = new PolicyVersionService(
      repo as unknown as Repository<ServerPolicyVersion>,
      lock,
      audit,
    );
  });

  it('creates versions incrementally and logs audit', async () => {
    const v1 = await service.createVersion({
      serverName: 'demo',
      policyJson: { rules: [] },
      actor: 'alice',
      publishLog: 'step1',
      status: 'SUCCESS',
    });
    expect(v1.versionNo).toBe(1);
    const v2 = await service.createVersion({
      serverName: 'demo',
      policyJson: { rules: [{ id: 1 }] },
      actor: 'bob',
      status: 'FAILED',
      publishLog: 'fail msg',
    });
    expect(v2.versionNo).toBe(2);
    expect(lockSpy).toHaveBeenCalledWith(
      serverLock('demo'),
      expect.any(Function),
    );
    expect(auditEntries.length).toBe(2);
    expect(auditEntries[0].actionType).toBe('PUBLISH_POLICY');
    expect(auditEntries[1].payload.detail.status).toBe('FAILED');
  });

  it('rollbacks by creating a new version copy and logs audit', async () => {
    await service.createVersion({
      serverName: 'demo',
      policyJson: { rules: [] },
    });
    await service.createVersion({
      serverName: 'demo',
      policyJson: { rules: [{ id: 1 }] },
    });
    const latestBefore = await service.findLatest('demo');
    const rollback = await service.rollback('demo', 1, 'charlie');
    expect(rollback?.versionNo).toBe(3);
    expect(rollback?.policyJson).toEqual({ rules: [] });
    const latest = await service.list('demo');
    expect(latest[0].versionNo).toBe(3);
    const rolled = repo.store.find((v) => v.id === latestBefore?.id);
    expect(rolled?.status).toBe('ROLLED_BACK');
  });
});
