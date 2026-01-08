import { PolicyPublishService } from '../policy-publish.service';
import { AdvisoryLockService } from '../../common/locks/advisory-lock.service';
import { OpsAuditService } from '../../ops-audit/ops-audit.service';
import { PolicyVersionService } from '../../versions/policy-version.service';
import { LOCK_GLOBAL_NGINX } from '../../common/locks/lock-keys';
import { Repository } from 'typeorm';
import { CoreRuleSetVersion } from '../../entities/core-rule-set-version.entity';
import { TemplateRuleSetVersion } from '../../entities/template-rule-set-version.entity';

describe('PolicyPublishService', () => {
  let lockSpy: jest.SpyInstance;
  let auditEntries: any[];
  let createdVersions: any[];
  let service: PolicyPublishService;
  let coreRepo: Partial<Repository<CoreRuleSetVersion>>;
  let tmplRepo: Partial<Repository<TemplateRuleSetVersion>>;

  beforeEach(() => {
    auditEntries = [];
    createdVersions = [];
    const lock = {
      withLock: jest.fn((key: string, fn: () => Promise<any>) => fn()),
    } as unknown as AdvisoryLockService;
    lockSpy = jest.spyOn(lock, 'withLock');
    const audit = {
      log: jest.fn((action, detail) => auditEntries.push({ action, detail })),
    } as unknown as OpsAuditService;
    const versions = {
      findByVersionNo: jest.fn(),
      createVersion: jest.fn((payload) => {
        const versionNo = createdVersions.length + 1;
        const saved = { versionNo, ...payload };
        createdVersions.push(saved);
        return saved;
      }),
    } as unknown as PolicyVersionService;
    const files = {
      writePolicy: jest.fn(() => ({ path: '/rules/user/demo.json' })),
    } as any;
    const nginx = {
      testConfig: jest.fn().mockResolvedValue({ stdout: '', stderr: 'ok' }),
      reload: jest.fn().mockResolvedValue({ stdout: '', stderr: 'reloaded' }),
    } as any;
    const nginxCfg = {
      updateServerRulesJson: jest.fn().mockResolvedValue({
        backupPath: '/backup/nginx.conf.1',
        targetPath: '/usr/local/nginx/conf/nginx.conf',
      }),
      restoreBackup: jest.fn(),
    } as any;
    const cfg = {
      get: jest.fn().mockReturnValue({
        rulesDir: '/usr/local/nginx/WAF_RULES_JSON',
        coreDir: '/usr/local/nginx/WAF_RULES_JSON/core',
        templateDir: '/usr/local/nginx/WAF_RULES_JSON/template',
      }),
    } as any;
    coreRepo = {
      findOne: jest.fn().mockResolvedValue({ coreName: 'core_sqli_rules' }),
    };
    tmplRepo = {
      findOne: jest.fn().mockResolvedValue({ templateName: 'tmpl_ip' }),
    };

    service = new PolicyPublishService(
      lock,
      audit,
      versions,
      files,
      nginx,
      nginxCfg,
      cfg,
      coreRepo as Repository<CoreRuleSetVersion>,
      tmplRepo as Repository<TemplateRuleSetVersion>,
    );
  });

  it('publishes with global nginx lock and creates version/audit', async () => {
    const result = await service.publish('demo', {
      enabledCoreRules: ['core_sqli_rules'],
      enabledTemplates: ['tmpl_ip'],
      rules: [
        {
          id: 1,
          target: 'URI',
          match: 'EXACT',
          pattern: '/admin',
          action: 'LOG',
        },
      ],
      dryRun: true,
      actor: 'alice',
    });

    expect(lockSpy).toHaveBeenCalledWith(
      LOCK_GLOBAL_NGINX,
      expect.any(Function),
    );
    expect(result.version).toBe(1);
    expect(result.dryRun).toBe(true);
    expect(auditEntries.length).toBe(1);
    expect(createdVersions[0].policyJson.core).toEqual(['core_sqli_rules']);
    expect(createdVersions[0].status).toBe('SUCCESS');
    expect(createdVersions[0].publishLog).toContain('pending nginx apply');
  });

  it('sanitizes rules and accepts dynamicBlock base score', async () => {
    const result = await service.publish('demo', {
      enabledCoreRules: [],
      enabledTemplates: [],
      dynamicBlockBaseScore: 1,
      rules: [
        {
          id: 2000,
          target: ['URI', 'BODY'],
          match: 'CONTAINS',
          pattern: ['select', 'union'],
          action: 'DENY',
          caseless: true,
          negate: false,
          score: 50,
        },
      ],
      dryRun: true,
    });

    expect(result.status).toBe('SUCCESS');
    const policy = createdVersions[0].policyJson;
    expect(policy.rules?.[0].target).toEqual(['URI', 'BODY']);
    expect(policy.policies?.dynamicBlock?.baseAccessScore).toBe(1);
  });

  it('records FAILED version when baseVersion missing', async () => {
    const lock = {
      withLock: jest.fn((key: string, fn: () => Promise<any>) => fn()),
    } as unknown as AdvisoryLockService;
    const _lockSpyLocal = jest.spyOn(lock, 'withLock');
    const audit = {
      log: jest.fn((action, detail) => auditEntries.push({ action, detail })),
    } as unknown as OpsAuditService;
    const versions = {
      findByVersionNo: jest.fn().mockResolvedValue(null),
      createVersion: jest.fn((payload) => {
        const versionNo = createdVersions.length + 1;
        const saved = { versionNo, ...payload };
        createdVersions.push(saved);
        return saved;
      }),
    } as unknown as PolicyVersionService;
    const files = { writePolicy: jest.fn() } as any;
    const nginx = { testConfig: jest.fn(), reload: jest.fn() } as any;
    const nginxCfg = {
      updateServerRulesJson: jest.fn().mockResolvedValue({
        backupPath: '/backup/nginx.conf.1',
        targetPath: '/usr/local/nginx/conf/nginx.conf',
      }),
      restoreBackup: jest.fn(),
    } as any;
    const cfg = {
      get: jest.fn().mockReturnValue({
        rulesDir: '/usr/local/nginx/WAF_RULES_JSON',
        coreDir: '/usr/local/nginx/WAF_RULES_JSON/core',
        templateDir: '/usr/local/nginx/WAF_RULES_JSON/template',
      }),
    } as any;
    const coreRepo: any = {
      findOne: jest.fn().mockResolvedValue({ coreName: 'c1' }),
    };
    const tmplRepo: any = {
      findOne: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          where.templateName === 'missing'
            ? null
            : { templateName: where.templateName },
        ),
    };

    const svc = new PolicyPublishService(
      lock,
      audit,
      versions,
      files,
      nginx,
      nginxCfg,
      cfg,
      coreRepo,
      tmplRepo,
    );
    const res = await svc.publish('demo', {
      enabledCoreRules: [],
      enabledTemplates: ['missing'],
      baseVersionId: 5,
      rules: [],
    });
    expect(res.status).toBe('FAILED');
    expect(res.error).toContain('baseVersion');
  });

  it('records FAILED version when baseVersion missing and rethrows', async () => {
    const lock = {
      withLock: jest.fn((key: string, fn: () => Promise<any>) => fn()),
    } as unknown as AdvisoryLockService;
    const lockSpyLocal = jest.spyOn(lock, 'withLock');
    const audit = {
      log: jest.fn((action, detail) => auditEntries.push({ action, detail })),
    } as unknown as OpsAuditService;
    const versions = {
      findByVersionNo: jest.fn().mockResolvedValue(null),
      createVersion: jest.fn((payload) => {
        const versionNo = createdVersions.length + 1;
        const saved = { versionNo, ...payload };
        createdVersions.push(saved);
        return saved;
      }),
    } as unknown as PolicyVersionService;
    const files = { writePolicy: jest.fn() } as any;
    const nginx = { testConfig: jest.fn(), reload: jest.fn() } as any;
    const nginxCfg = {
      updateServerRulesJson: jest.fn().mockResolvedValue({
        backupPath: '/backup/nginx.conf.1',
        targetPath: '/usr/local/nginx/conf/nginx.conf',
      }),
      restoreBackup: jest.fn(),
    } as any;
    const cfg = {
      get: jest.fn().mockReturnValue({
        rulesDir: '/usr/local/nginx/WAF_RULES_JSON',
        coreDir: '/usr/local/nginx/WAF_RULES_JSON/core',
        templateDir: '/usr/local/nginx/WAF_RULES_JSON/template',
      }),
    } as any;
    const coreRepo: any = {
      findOne: jest.fn().mockResolvedValue({ coreName: 'c1' }),
    };
    const tmplRepo: any = {
      findOne: jest.fn().mockResolvedValue({ templateName: 't1' }),
    };

    const svc = new PolicyPublishService(
      lock,
      audit,
      versions,
      files,
      nginx,
      nginxCfg,
      cfg,
      coreRepo,
      tmplRepo,
    );
    const res = await svc.publish('demo', {
      enabledCoreRules: [],
      enabledTemplates: [],
      baseVersionId: 5,
      rules: [],
    });

    expect(lockSpyLocal).toHaveBeenCalledWith(
      LOCK_GLOBAL_NGINX,
      expect.any(Function),
    );
    expect(createdVersions.at(-1)?.status).toBe('FAILED');
    expect(createdVersions.at(-1)?.publishLog).toContain(
      'baseVersion v1.5 not found',
    );
    expect(res.status).toBe('FAILED');
    expect(res.version).toBe(createdVersions.at(-1)?.versionNo);
    expect(res.steps?.some((s: any) => s.status === 'FAILED')).toBeTruthy();
    expect(
      auditEntries.some((e) => e.detail.status === 'FAILED' || e.detail?.error),
    ).toBeTruthy();
  });

  it('publishes non-dry run and touches nginx config + reload', async () => {
    const lock = {
      withLock: jest.fn((key: string, fn: () => Promise<any>) => fn()),
    } as unknown as AdvisoryLockService;
    const audit: any = { log: jest.fn() };
    const created: any[] = [];
    const versions: any = {
      findByVersionNo: jest.fn(),
      createVersion: jest.fn((p: any) => {
        const v = { versionNo: created.length + 1, ...p };
        created.push(v);
        return v;
      }),
    };
    const files: any = {
      writePolicy: jest.fn(() => ({ path: '/rules/user/demo.json' })),
    };
    const nginx: any = {
      testConfig: jest.fn().mockResolvedValue({ stdout: '', stderr: 'ok' }),
      reload: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    };
    const nginxCfg: any = {
      updateServerRulesJson: jest
        .fn()
        .mockResolvedValue({ backupPath: '/backup/nginx.conf.1' }),
      restoreBackup: jest.fn(),
    };
    const cfg: any = {
      get: jest.fn().mockReturnValue({
        rulesDir: '/usr/local/nginx/WAF_RULES_JSON',
        coreDir: '/usr/local/nginx/WAF_RULES_JSON/core',
        templateDir: '/usr/local/nginx/WAF_RULES_JSON/template',
      }),
    };
    const coreRepo: any = {
      findOne: jest.fn().mockResolvedValue({ coreName: 'c1' }),
    };
    const tmplRepo: any = {
      findOne: jest.fn().mockResolvedValue({ templateName: 't1' }),
    };

    const svc = new PolicyPublishService(
      lock,
      audit,
      versions,
      files,
      nginx,
      nginxCfg,
      cfg,
      coreRepo,
      tmplRepo,
    );
    const res = await svc.publish('demo', {
      enabledCoreRules: [],
      enabledTemplates: [],
      rules: [],
      dryRun: false,
      actor: 'alice',
    });

    expect(files.writePolicy).toHaveBeenCalled();
    expect(nginxCfg.updateServerRulesJson).toHaveBeenCalled();
    expect(nginx.testConfig).toHaveBeenCalled();
    expect(nginx.reload).toHaveBeenCalled();
    expect(res.status).toBe('SUCCESS');
  });

  it('updates runtime with lock and writes new version', async () => {
    const lock: any = { withLock: jest.fn((k: string, fn: any) => fn()) };
    const audit: any = { log: jest.fn() };
    const versions: any = {
      findLatest: jest.fn().mockResolvedValue({
        versionNo: 1,
        policyJson: {
          meta: { name: 'demo' },
          policies: { runtime: { wafEnabled: true } },
          enabledCoreRules: ['core_a'],
          enabledTemplates: ['tmpl_a'],
        },
        enabledCoreRules: ['core_a'],
        enabledTemplates: ['tmpl_a'],
        note: 'init',
      }),
      createVersion: jest.fn(async (p: any) => ({ versionNo: 2, ...p })),
    };
    const files: any = {
      writePolicy: jest.fn(() => ({ path: '/rules/user/demo.json' })),
    };
    const nginx: any = {
      testConfig: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
      reload: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    };
    const nginxCfg: any = {
      updateServerRulesJson: jest.fn().mockResolvedValue({
        backupPath: '/backup/nginx.conf.1',
        targetPath: '/usr/local/nginx/conf/nginx.conf',
      }),
      restoreBackup: jest.fn(),
    };
    const cfg: any = {
      get: jest.fn().mockReturnValue({
        rulesDir: '/usr/local/nginx/WAF_RULES_JSON',
        coreDir: '/usr/local/nginx/WAF_RULES_JSON/core',
        templateDir: '/usr/local/nginx/WAF_RULES_JSON/template',
      }),
    };
    const coreRepo: any = {
      findOne: jest.fn().mockResolvedValue({ coreName: 'c1' }),
    };
    const tmplRepo: any = {
      findOne: jest.fn().mockResolvedValue({ templateName: 't1' }),
    };

    const svc = new PolicyPublishService(
      lock,
      audit,
      versions,
      files,
      nginx,
      nginxCfg,
      cfg,
      coreRepo,
      tmplRepo,
    );

    const res = await svc.updateRuntime('demo', {
      wafEnabled: false,
      dynamicBlockEnabled: true,
      actor: 'ops',
      note: 'switch',
    });

    expect(files.writePolicy).toHaveBeenCalled();
    expect(versions.createVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SUCCESS',
        actor: 'ops',
      }),
    );
    expect(res.status).toBe('SUCCESS');
    expect(audit.log).toHaveBeenCalledWith(
      'TOGGLE_WAF',
      expect.objectContaining({
        status: 'SUCCESS',
        actor: 'ops',
      }),
    );
  });

  it('restores backup when reload fails after config update', async () => {
    const lock: any = { withLock: jest.fn((k: string, fn: any) => fn()) };
    const audit: any = { log: jest.fn() };
    const versions: any = {
      findByVersionNo: jest.fn(),
      createVersion: jest.fn((p: any) => ({ versionNo: 1, ...p })),
    };
    const files: any = {
      writePolicy: jest.fn(() => ({ path: '/rules/user/demo.json' })),
    };
    const nginx: any = {
      testConfig: jest.fn().mockResolvedValue({ stdout: '', stderr: 'ok' }),
      reload: jest.fn().mockRejectedValue(new Error('reload error')),
    };
    const nginxCfg: any = {
      updateServerRulesJson: jest.fn().mockResolvedValue({
        backupPath: '/backup/nginx.conf.1',
        targetPath: '/usr/local/nginx/conf/nginx.conf',
      }),
      restoreBackup: jest.fn().mockResolvedValue(undefined),
    };
    const cfg: any = {
      get: jest.fn().mockReturnValue({
        rulesDir: '/usr/local/nginx/WAF_RULES_JSON',
        coreDir: '/usr/local/nginx/WAF_RULES_JSON/core',
        templateDir: '/usr/local/nginx/WAF_RULES_JSON/template',
      }),
    };
    const coreRepo: any = {
      findOne: jest.fn().mockResolvedValue({ coreName: 'c1' }),
    };
    const tmplRepo: any = {
      findOne: jest.fn().mockResolvedValue({ templateName: 't1' }),
    };

    const svc = new PolicyPublishService(
      lock,
      audit,
      versions,
      files,
      nginx,
      nginxCfg,
      cfg,
      coreRepo,
      tmplRepo,
    );
    const res = await svc.publish('demo', {
      enabledCoreRules: [],
      enabledTemplates: [],
      dryRun: false,
    });

    expect(nginxCfg.restoreBackup).toHaveBeenCalledWith(
      '/backup/nginx.conf.1',
      '/usr/local/nginx/conf/nginx.conf',
    );
    expect(versions.createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'FAILED' }),
    );
    expect(res.status).toBe('FAILED');
    expect(
      res.rollbackSteps?.some((s: any) => s.key === 'restoreNginxConf'),
    ).toBeTruthy();
  });
});
