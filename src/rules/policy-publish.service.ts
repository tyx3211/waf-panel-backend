import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdvisoryLockService } from '../common/locks/advisory-lock.service';
import { LOCK_GLOBAL_NGINX } from '../common/locks/lock-keys';
import { OpsAuditService } from '../ops-audit/ops-audit.service';
import { PolicyVersionService } from '../versions/policy-version.service';
import { PublishPolicyDto } from './dto/publish-policy.dto';
import { VersionStatus } from '../entities/server-policy-version.entity';
import { RulesFilesystemService } from './rules-filesystem.service';
import { NginxCommandService } from './nginx-command.service';
import { NginxConfigService } from './nginx-config.service';
import { ConfigService } from '@nestjs/config';
import { WafConfig } from '../config/waf.config';
import path from 'path';
import { UpdateRuntimeDto } from './dto/update-runtime.dto';
import { CoreRuleSetVersion } from '../entities/core-rule-set-version.entity';
import { TemplateRuleSetVersion } from '../entities/template-rule-set-version.entity';
import { type RuleObject, sanitizeRules } from '../common/rules/rule-schema';

interface RuntimePolicy {
  wafEnabled?: boolean;
  dynamicBlockEnabled?: boolean;
  defaultAction?: string;
}

interface PolicyDoc {
  meta?: {
    name?: string;
    extends?: Array<string | Record<string, unknown>>;
    duplicatePolicy?: string;
  };
  disableById?: number[];
  disableByTag?: string[];
  policies?: {
    runtime?: RuntimePolicy;
    dynamicBlock?: {
      baseAccessScore?: number;
    };
    [key: string]: unknown;
  };
  core?: string[];
  templates?: string[];
  rules?: RuleObject[];
  [key: string]: unknown;
}

@Injectable()
export class PolicyPublishService {
  private readonly logger = new Logger(PolicyPublishService.name);

  private readonly pipelineOrder: PipelineStepKey[] = [
    'composePolicy',
    'writePolicyFile',
    'updateNginxConf',
    'nginxTest',
    'nginxReload',
  ];

  constructor(
    private readonly locks: AdvisoryLockService,
    private readonly audit: OpsAuditService,
    private readonly versions: PolicyVersionService,
    private readonly files: RulesFilesystemService,
    private readonly nginx: NginxCommandService,
    private readonly nginxConfig: NginxConfigService,
    private readonly configService: ConfigService,
    @InjectRepository(CoreRuleSetVersion)
    private readonly coreRepo: Repository<CoreRuleSetVersion>,
    @InjectRepository(TemplateRuleSetVersion)
    private readonly templateRepo: Repository<TemplateRuleSetVersion>,
  ) {}

  async listAllServers() {
    const dbList = await this.versions.listAllServerNames();
    const nginxList = await this.nginxConfig.listServerNames();
    return Array.from(new Set([...dbList, ...nginxList]));
  }

  async getRuntime(serverName: string) {
    return this.nginxConfig.getServerRuntimeDirectives(serverName);
  }

  async publish(serverName: string, dto: PublishPolicyDto) {
    return this.locks.withLock(LOCK_GLOBAL_NGINX, async () => {
      const normalized = this.normalizeDto(dto);
      const sanitizedRules = sanitizeRules(
        normalized.rules as unknown as Record<string, unknown>[],
      );
      const logLines: string[] = [];
      const actor = normalized.actor;
      let backupPath: string | undefined;
      let targetConfPath: string | undefined;
      const steps: PipelineStepResult[] = [];
      const rollbackSteps: PipelineStepResult[] = [];
      let failedVersionNo: number | undefined;
      try {
        steps.push(stepPending('composePolicy'));
        if (normalized.baseVersionId) {
          await this.assertBaseVersion(serverName, normalized.baseVersionId);
          logLines.push(`baseVersion=v1.${normalized.baseVersionId} verified`);
        }
        await this.assertReferences(
          normalized.enabledCoreRules,
          normalized.enabledTemplates,
        );
        const policyJson = this.composePolicy(
          serverName,
          normalized,
          sanitizedRules,
        );
        logLines.push('policyJson composed');
        markStepOk(steps, 'composePolicy');

        if (!normalized.dryRun) {
          steps.push(stepPending('writePolicyFile'));
          const { path } = this.files.writePolicy(serverName, policyJson);
          logLines.push(`policy written: ${path}`);
          markStepOk(steps, 'writePolicyFile', { message: path });

          steps.push(stepPending('updateNginxConf'));
          const cfgRes = await this.nginxConfig.updateServerRulesJson(
            serverName,
            path,
          );
          backupPath = cfgRes.backupPath;
          targetConfPath = cfgRes.targetPath;
          logLines.push(
            `nginx.conf updated (backup=${cfgRes.backupPath ?? 'none'})`,
          );
          markStepOk(steps, 'updateNginxConf', { message: cfgRes.targetPath });

          steps.push(stepPending('nginxTest'));
          const testRes = await this.nginx.testConfig();
          const testOut = trimLog(testRes.stderr || testRes.stdout);
          logLines.push(`nginx -t -q ok: ${testOut}`);
          markStepWarnOrOk(steps, 'nginxTest', testOut);

          steps.push(stepPending('nginxReload'));
          const reloadRes = await this.nginx.reload();
          const reloadOut = trimLog(reloadRes.stderr || reloadRes.stdout);
          logLines.push(`nginx reload ok: ${reloadOut}`);
          markStepWarnOrOk(steps, 'nginxReload', reloadOut);
        } else {
          logLines.push('dryRun=true: skip write/nginx reload');
          this.markDryRunSkipped(steps);
        }

        const publishLog = this.joinLogs(logLines, normalized.dryRun);
        const saved = await this.versions.createVersion({
          serverName,
          policyJson,
          enabledCoreRules: normalized.enabledCoreRules,
          enabledTemplates: normalized.enabledTemplates,
          note: normalized.note,
          actor,
          status: 'SUCCESS',
          publishLog,
        });

        await this.audit.log('PUBLISH_POLICY', {
          targetType: 'server',
          targetName: serverName,
          status: 'SUCCESS',
          actor,
          note: normalized.note,
          detail: {
            versionNo: saved.versionNo,
            dryRun: normalized.dryRun ?? false,
            publishLog,
            steps,
          },
        });

        this.logger.log(
          `Published policy for server=${serverName} v1.${saved.versionNo} (dryRun=${normalized.dryRun ?? false})`,
        );
        return {
          version: saved.versionNo,
          status: 'SUCCESS',
          dryRun: normalized.dryRun ?? false,
          publishLog,
          steps,
          rollbackSteps: [],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const failedLog = this.joinLogs(
          [...logLines, `error: ${message}`],
          normalized.dryRun,
        );
        failedVersionNo = await this.persistFailure(
          serverName,
          normalized,
          failedLog,
        );
        await this.audit.log('PUBLISH_POLICY', {
          targetType: 'server',
          targetName: serverName,
          status: 'FAILED',
          actor,
          note: normalized.note,
          detail: {
            error: message,
            publishLog: failedLog,
            steps,
            rollbackSteps,
          },
        });
        if (backupPath && targetConfPath && !normalized.dryRun) {
          await this.nginxConfig.restoreBackup(backupPath, targetConfPath);
          rollbackSteps.push({
            key: 'restoreNginxConf',
            status: 'WARN',
            message: `restored from ${backupPath}`,
            stdout: '',
            stderr: '',
          });
          this.logger.warn(`restore nginx.conf from backup=${backupPath}`);
        }
        this.logger.error(
          `Publish failed for server=${serverName}: ${message}`,
        );
        markFailureAtLastPending(steps, message);
        return {
          status: 'FAILED',
          dryRun: normalized.dryRun ?? false,
          version: failedVersionNo,
          publishLog: failedLog,
          steps,
          rollbackSteps,
          error: message,
        };
      }
    });
  }

  private normalizeDto(dto: PublishPolicyDto): PublishPolicyDto {
    return {
      ...dto,
      enabledCoreRules: dto.enabledCoreRules ?? [],
      enabledTemplates: dto.enabledTemplates ?? [],
      rules: dto.rules ?? [],
      dryRun: dto.dryRun ?? false,
    };
  }

  private markDryRunSkipped(steps: PipelineStepResult[]): void {
    for (const key of this.pipelineOrder) {
      const existed = steps.find((s) => s.key === key);
      if (!existed) {
        steps.push(stepPending(key));
      }
    }
    for (const s of steps) {
      markSkipped(s);
    }
  }

  private async assertBaseVersion(
    serverName: string,
    versionNo: number,
  ): Promise<void> {
    const existed = await this.versions.findByVersionNo(serverName, versionNo);
    if (!existed) {
      throw new Error(
        `baseVersion v1.${versionNo} not found for server=${serverName}`,
      );
    }
  }

  private async assertReferences(coreNames: string[], templateNames: string[]) {
    for (const name of coreNames ?? []) {
      const existed = await this.coreRepo.findOne({
        where: { coreName: name },
        order: { versionNo: 'DESC' },
      });
      if (!existed) {
        throw new Error(`core rule set not found: ${name}`);
      }
    }
    for (const name of templateNames ?? []) {
      const existed = await this.templateRepo.findOne({
        where: { templateName: name },
        order: { versionNo: 'DESC' },
      });
      if (!existed) {
        throw new Error(`template not found: ${name}`);
      }
    }
  }

  private composePolicy(
    serverName: string,
    dto: PublishPolicyDto,
    rules: RuleObject[],
  ): PolicyDoc {
    const extendsEntries = this.buildExtends(
      dto.enabledCoreRules,
      dto.enabledTemplates,
    );
    const policy: PolicyDoc = {
      meta: {
        name: serverName,
        extends: extendsEntries,
        duplicatePolicy: 'warn_keep_last',
      },
      core: dto.enabledCoreRules ?? [],
      templates: dto.enabledTemplates ?? [],
      rules,
    };

    const policies: PolicyDoc['policies'] = {};
    if (dto.dynamicBlockBaseScore !== undefined) {
      policies.dynamicBlock = { baseAccessScore: dto.dynamicBlockBaseScore };
    }
    if (Object.keys(policies).length > 0) {
      policy.policies = policies;
    }
    return policy;
  }

  private buildExtends(
    core: string[],
    templates: string[],
  ): Array<string | Record<string, string>> {
    const cfg = this.configService.get<WafConfig>('waf');
    const rulesDir = cfg?.rulesDir || '/usr/local/nginx/WAF_RULES_JSON';
    const userDir = path.join(rulesDir, 'user');
    const relToUser = (targetPath: string) => {
      const rel = path.relative(userDir, targetPath);
      return rel.split(path.sep).join('/');
    };
    const list: Array<string> = [];
    for (const c of core ?? []) {
      const target =
        (cfg?.coreDir || path.join(rulesDir, 'core')) + `/${c}.json`;
      list.push(relToUser(target));
    }
    for (const t of templates ?? []) {
      const target =
        (cfg?.templateDir || path.join(rulesDir, 'template')) + `/${t}.json`;
      list.push(relToUser(target));
    }
    return list;
  }

  private joinLogs(lines: string[], dryRun?: boolean): string {
    const header = dryRun
      ? 'dryRun=true; pending nginx apply'
      : 'pending nginx apply';
    return [header, ...lines].join(' | ');
  }

  async updateRuntime(serverName: string, dto: UpdateRuntimeDto) {
    return this.locks.withLock(LOCK_GLOBAL_NGINX, async () => {
      const logLines: string[] = ['runtime update (direct nginx directive)'];
      const actor = dto.actor;
      const steps: PipelineStepResult[] = [];
      const rollbackSteps: PipelineStepResult[] = [];
      let backupPath: string | undefined;
      let targetConfPath: string | undefined;

      try {
        steps.push(stepPending('updateNginxConf'));

        // Directly update nginx.conf directives - NO version system involved
        const cfgRes = await this.nginxConfig.updateServerRuntimeDirectives(
          serverName,
          {
            waf: dto.wafEnabled,
            dynamicBlock: dto.dynamicBlockEnabled,
            defaultAction: dto.defaultAction
          }
        );
        
        backupPath = cfgRes.backupPath;
        targetConfPath = cfgRes.targetPath;
        logLines.push(
          `nginx.conf directives updated (backup=${cfgRes.backupPath ?? 'none'})`,
        );
        markStepOk(steps, 'updateNginxConf', { message: 'Updated directives in nginx.conf' });

        steps.push(stepPending('nginxTest'));
        const testRes = await this.nginx.testConfig();
        const testOut = trimLog(testRes.stderr || testRes.stdout);
        markStepWarnOrOk(steps, 'nginxTest', testOut);
        logLines.push(`nginx -t -q: ${testOut}`);

        steps.push(stepPending('nginxReload'));
        const reloadRes = await this.nginx.reload();
        const reloadOut = trimLog(reloadRes.stderr || reloadRes.stdout);
        markStepWarnOrOk(steps, 'nginxReload', reloadOut);
        logLines.push(`nginx reload: ${reloadOut}`);

        const publishLog = this.joinLogs(logLines);

        await this.audit.log('TOGGLE_WAF', {
          targetType: 'server',
          targetName: serverName,
          status: 'SUCCESS',
          actor,
          note: dto.note,
          detail: {
            wafEnabled: dto.wafEnabled,
            dynamicBlockEnabled: dto.dynamicBlockEnabled,
            defaultAction: dto.defaultAction,
            steps,
          },
        });

        return {
          status: 'SUCCESS',
          publishLog,
          steps,
          rollbackSteps,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const failedLog = this.joinLogs([...logLines, `error: ${message}`]);
        await this.audit.log('TOGGLE_WAF', {
          targetType: 'server',
          targetName: serverName,
          status: 'FAILED',
          actor,
          note: dto.note,
          detail: {
            wafEnabled: dto.wafEnabled,
            dynamicBlockEnabled: dto.dynamicBlockEnabled,
            defaultAction: dto.defaultAction,
            steps,
            rollbackSteps,
            error: message,
          },
        });
        if (backupPath && targetConfPath) {
          await this.nginxConfig.restoreBackup(backupPath, targetConfPath);
          rollbackSteps.push({
            key: 'restoreNginxConf',
            status: 'WARN',
            message: `restored from ${backupPath}`,
            stdout: '',
            stderr: '',
          });
        }
        markFailureAtLastPending(steps, message);
        return {
          status: 'FAILED',
          publishLog: failedLog,
          steps,
          rollbackSteps,
          error: message,
        };
      }
    });
  }

  private async persistFailure(
    serverName: string,
    dto: PublishPolicyDto,
    publishLog: string,
  ): Promise<number | undefined> {
    try {
      const rules = sanitizeRules(
        dto.rules as unknown as Record<string, unknown>[],
      );
      const saved = await this.versions.createVersion({
        serverName,
        policyJson: this.composePolicy(serverName, dto, rules),
        enabledCoreRules: dto.enabledCoreRules,
        enabledTemplates: dto.enabledTemplates,
        note: dto.note,
        actor: dto.actor,
        status: 'FAILED' as VersionStatus,
        publishLog,
      });
      return saved.versionNo;
    } catch (persistErr) {
      this.logger.warn(
        `record failed publish version error: ${(persistErr as Error).message}`,
      );
      return undefined;
    }
  }

  async rollbackToVersion(
    serverName: string,
    versionNo: number,
    actor?: string,
  ) {
    const target = await this.versions.findByVersionNo(serverName, versionNo);
    if (!target) {
      throw new Error(`Target version v1.${versionNo} not found`);
    }

    const policy = target.policyJson as PolicyDoc;
    const rules = (policy.rules || []) as unknown as Record<string, unknown>[];

    return this.publish(serverName, {
      enabledCoreRules: target.enabledCoreRules ?? [],
      enabledTemplates: target.enabledTemplates ?? [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      rules: rules as any,
      note: `rollback to v1.${versionNo}`,
      actor,
      dryRun: false,
    });
  }
  async getGlobalConfig() {
    return this.nginxConfig.getGlobalRuntimeDirectives();
  }

  async updateGlobalConfig(
    dto: { 
      trustXff?: boolean; 
      logLevel?: string; 
      dynamicBlockScore?: number; 
      dynamicBlockDuration?: string;
      dynamicBlockWindow?: string;
      note?: string; 
      actor?: string 
    },
  ) {
    return this.locks.withLock(LOCK_GLOBAL_NGINX, async () => {
      const logLines: string[] = ['global config update'];
      const steps: PipelineStepResult[] = [];
      const rollbackSteps: PipelineStepResult[] = [];
      let backupPath: string | undefined;
      let targetConfPath: string | undefined;

      try {
        steps.push(stepPending('updateNginxConf'));
        const cfgRes = await this.nginxConfig.updateGlobalRuntimeDirectives({
          trustXff: dto.trustXff,
          logLevel: dto.logLevel,
          dynamicBlockScore: dto.dynamicBlockScore,
          dynamicBlockDuration: dto.dynamicBlockDuration,
          dynamicBlockWindow: dto.dynamicBlockWindow
        });
        
        backupPath = cfgRes.backupPath;
        targetConfPath = cfgRes.targetPath;
        logLines.push(`global config updated (backup=${cfgRes.backupPath ?? 'none'})`);
        markStepOk(steps, 'updateNginxConf', { message: 'Updated global directives' });

        steps.push(stepPending('nginxTest'));
        const testRes = await this.nginx.testConfig();
        const testOut = trimLog(testRes.stderr || testRes.stdout);
        markStepWarnOrOk(steps, 'nginxTest', testOut);
        logLines.push(`nginx -t: ${testOut}`);

        steps.push(stepPending('nginxReload'));
        const reloadRes = await this.nginx.reload();
        const reloadOut = trimLog(reloadRes.stderr || reloadRes.stdout);
        markStepWarnOrOk(steps, 'nginxReload', reloadOut);
        logLines.push(`nginx reload: ${reloadOut}`);

        const publishLog = this.joinLogs(logLines);

        await this.audit.log('UPDATE_GLOBAL_CONFIG', {
          targetType: 'system',
          targetName: 'global',
          status: 'SUCCESS',
          actor: dto.actor,
          note: dto.note,
          detail: {
            config: dto,
            steps
          },
        });

        return { status: 'SUCCESS', publishLog, steps };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const failedLog = this.joinLogs([...logLines, `error: ${message}`]);
        
        if (backupPath && targetConfPath) {
          await this.nginxConfig.restoreBackup(backupPath, targetConfPath);
          rollbackSteps.push({
            key: 'restoreNginxConf',
            status: 'WARN',
            message: `restored from ${backupPath}`,
          });
        }
        
        markFailureAtLastPending(steps, message);
        return { status: 'FAILED', error: message, publishLog: failedLog, steps, rollbackSteps };
      }
    });
  }
}

function trimLog(input: string): string {
  return (input || '').trim().slice(0, 500);
}

type PipelineStepKey =
  | 'composePolicy'
  | 'writePolicyFile'
  | 'updateNginxConf'
  | 'nginxTest'
  | 'nginxReload'
  | 'restoreNginxConf';

type PipelineStepStatus = 'SUCCESS' | 'WARN' | 'FAILED' | 'SKIPPED' | 'PENDING';

export interface PipelineStepResult {
  key: PipelineStepKey;
  status: PipelineStepStatus;
  message?: string;
  stdout?: string;
  stderr?: string;
}

function stepPending(key: PipelineStepKey): PipelineStepResult {
  return { key, status: 'PENDING' };
}

function markStepOk(
  steps: PipelineStepResult[],
  key: PipelineStepKey,
  extra?: Partial<PipelineStepResult>,
) {
  const step = steps.find((s) => s.key === key && s.status === 'PENDING');
  if (step) {
    step.status = 'SUCCESS';
    if (extra?.message) step.message = extra.message;
    if (extra?.stdout) step.stdout = extra.stdout;
    if (extra?.stderr) step.stderr = extra.stderr;
  }
}

function markStepWarnOrOk(
  steps: PipelineStepResult[],
  key: PipelineStepKey,
  output: string,
) {
  const step = steps.find((s) => s.key === key && s.status === 'PENDING');
  if (!step) return;
  const status: PipelineStepStatus = output ? 'WARN' : 'SUCCESS';
  step.status = status;
  step.message = output || undefined;
}

function markFailureAtLastPending(
  steps: PipelineStepResult[],
  message: string,
) {
  const pending = [...steps].reverse().find((s) => s.status === 'PENDING');
  if (pending) {
    pending.status = 'FAILED';
    pending.stderr = message;
  } else {
    steps.push({ key: 'nginxReload', status: 'FAILED', stderr: message });
  }
}

function markSkipped(step: PipelineStepResult) {
  if (step.status === 'PENDING') {
    step.status = 'SKIPPED';
    step.message = 'dryRun: skipped';
  }
}
