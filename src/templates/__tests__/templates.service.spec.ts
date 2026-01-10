import { TemplatesService } from '../templates.service';
import { TemplateRuleSetVersion } from '../../entities/template-rule-set-version.entity';
import { AdvisoryLockService } from '../../common/locks/advisory-lock.service';
import { OpsAuditService } from '../../ops-audit/ops-audit.service';
import { Repository } from 'typeorm';
import { templateLock } from '../../common/locks/lock-keys';
import { RuleValidationError } from '../../common/rules/rules-validation';

class FakeRepo {
  store: TemplateRuleSetVersion[] = [];
  manager = {
    transaction: async <T>(
      fn: (manager: { getRepository: () => FakeRepo }) => Promise<T>,
    ) => fn({ getRepository: () => this }),
  };
  create(data: Partial<TemplateRuleSetVersion>): TemplateRuleSetVersion {
    return {
      id: this.store.length + 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    } as TemplateRuleSetVersion;
  }
  async save(entity: TemplateRuleSetVersion) {
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
      .filter((v) =>
        where.templateName ? v.templateName === where.templateName : true,
      )
      .sort((a, b) => b.versionNo - a.versionNo);
  }
  async findOne(options: any) {
    const where = options.where || {};
    const ordered = this.store
      .filter((v) =>
        where.templateName ? v.templateName === where.templateName : true,
      )
      .sort((a, b) => b.versionNo - a.versionNo);
    if (where.versionNo !== undefined) {
      return ordered.find((v) => v.versionNo === where.versionNo) ?? null;
    }
    return ordered[0] ?? null;
  }
}

describe('TemplatesService', () => {
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
  let service: TemplatesService;

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
    // Mock RulesFilesystemService
    const files = {
      writeTemplate: jest.fn(),
      deleteTemplate: jest.fn(),
    } as any;

    service = new TemplatesService(
      repo as unknown as Repository<TemplateRuleSetVersion>,
      lock, // Assuming 'notify' was a typo and 'lock' should remain
      audit,
      files,
    );
  });

  it('creates template versions and forbids extends', async () => {
    const saved = await service.create(
      'tmpl_ip',
      { rules: [baseRule] },
      'note',
      'alice',
    );
    expect(saved.versionNo).toBe(1);
    expect(lockSpy).toHaveBeenCalledWith(
      templateLock('tmpl_ip'),
      expect.any(Function),
    );
    expect(auditCalls.length).toBe(1);

    await expect(
      service.create('tmpl_ip', { meta: { extends: ['foo'] }, rules: [] }),
    ).rejects.toBeInstanceOf(RuleValidationError);
  });

  it('rollbacks template version by creating new version', async () => {
    await service.create('tmpl_ip', { rules: [baseRule] });
    await service.create('tmpl_ip', { rules: [{ ...baseRule, id: 2 }] });
    const rolled = await service.rollback('tmpl_ip', 1, 'bob');
    expect(rolled?.versionNo).toBe(3);
    expect((rolled?.rulesJson as any).rules[0].id).toBe(1);
  });
});
