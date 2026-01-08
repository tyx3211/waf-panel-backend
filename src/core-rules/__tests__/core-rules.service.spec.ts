import { CoreRulesService } from '../core-rules.service';
import { CoreRuleSetVersion } from '../../entities/core-rule-set-version.entity';
import { Repository } from 'typeorm';
import { AdvisoryLockService } from '../../common/locks/advisory-lock.service';
import { OpsAuditService } from '../../ops-audit/ops-audit.service';
import { coreLock } from '../../common/locks/lock-keys';
import { FACTORY_VERSION_NO } from '../../common/rules/consts';

class FakeRepo {
  store: CoreRuleSetVersion[] = [];
  manager = {
    transaction: async <T>(
      fn: (manager: { getRepository: () => FakeRepo }) => Promise<T>,
    ) => fn({ getRepository: () => this }),
  };

  create(data: Partial<CoreRuleSetVersion>): CoreRuleSetVersion {
    return {
      id: this.store.length + 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    } as CoreRuleSetVersion;
  }
  async save(entity: CoreRuleSetVersion) {
    const existing = this.store.find((v) => v.id === entity.id);
    if (existing) {
      Object.assign(existing, entity);
      return existing;
    }
    this.store.push(entity);
    return entity;
  }
  async find(options: any) {
    const where = options.where || {};
    return this.store
      .filter((v) => (where.coreName ? v.coreName === where.coreName : true))
      .sort((a, b) => b.versionNo - a.versionNo);
  }
  async findOne(options: any) {
    const where = options.where || {};
    const ordered = this.store
      .filter((v) => (where.coreName ? v.coreName === where.coreName : true))
      .sort((a, b) => b.versionNo - a.versionNo);
    if (where.versionNo !== undefined) {
      return ordered.find((v) => v.versionNo === where.versionNo) ?? null;
    }
    return ordered[0] ?? null;
  }
}

describe('CoreRulesService', () => {
  const baseRule = {
    id: 1,
    target: 'URI',
    match: 'CONTAINS',
    pattern: '/admin',
    action: 'DENY',
  };
  let repo: FakeRepo;
  let lockSpy: jest.SpyInstance;
  let auditCalls: any[];
  let service: CoreRulesService;

  beforeEach(() => {
    repo = new FakeRepo();
    auditCalls = [];
    const lock = {
      withLock: jest.fn((key: string, fn: () => Promise<any>) => fn()),
    } as unknown as AdvisoryLockService;
    lockSpy = jest.spyOn(lock, 'withLock');
    const audit = {
      logWithManager: jest.fn((_, action, payload) =>
        auditCalls.push({ action, payload }),
      ),
    } as unknown as OpsAuditService;

    service = new CoreRulesService(
      repo as unknown as Repository<CoreRuleSetVersion>,
      lock,
      audit,
    );
  });

  const seedFactory = async () => {
    await repo.save(
      repo.create({
        coreName: 'core_sqli_rules',
        versionNo: FACTORY_VERSION_NO,
        rulesJson: { rules: [baseRule], meta: { name: 'core_sqli_rules' } },
        status: 'SUCCESS',
        note: 'factory baseline',
      }),
    );
  };

  it('creates core version with sanitized meta and tags, starts at v1.1 after factory', async () => {
    await seedFactory();
    const saved = await service.create(
      'core_sqli_rules',
      { rules: [baseRule] },
      'note',
      'alice',
    );
    expect(saved.versionNo).toBe(FACTORY_VERSION_NO + 1);
    expect((saved.rulesJson as any).meta.name).toBe('core_sqli_rules');
    expect((saved.rulesJson as any).rules[0].tags).toContain('sqli');
    expect(lockSpy).toHaveBeenCalledWith(
      coreLock('core_sqli_rules'),
      expect.any(Function),
    );
    expect(auditCalls.length).toBe(1);
  });

  it('rolls back by creating new version from target', async () => {
    await seedFactory();
    await service.create('core_sqli_rules', { rules: [baseRule] });
    await service.create('core_sqli_rules', {
      rules: [{ ...baseRule, id: 2 }],
    });
    const rolled = await service.rollback(
      'core_sqli_rules',
      FACTORY_VERSION_NO,
      'bob',
    );
    expect(rolled?.versionNo).toBe(FACTORY_VERSION_NO + 3);
    expect((rolled?.rulesJson as any).rules[0].id).toBe(1);
  });

  it('restore factory is equivalent to rollback to v1.0', async () => {
    await seedFactory();
    await service.create('core_sqli_rules', { rules: [baseRule] });
    await service.create('core_sqli_rules', {
      rules: [{ ...baseRule, id: 2 }],
    });
    const rolled = await service.rollback(
      'core_sqli_rules',
      FACTORY_VERSION_NO,
      'bob',
    );
    expect((rolled?.rulesJson as any).rules[0].id).toBe(1);
  });
});
