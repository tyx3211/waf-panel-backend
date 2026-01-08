import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdvisoryLockService } from '../common/locks/advisory-lock.service';
import { CoreRuleSetVersion } from '../entities/core-rule-set-version.entity';
import { OpsAuditService } from '../ops-audit/ops-audit.service';
import { coreLock } from '../common/locks/lock-keys';
import { sanitizeCoreRules } from '../common/rules/rules-validation';
import { FACTORY_VERSION_NO } from '../common/rules/consts';

@Injectable()
export class CoreRulesService {
  private readonly logger = new Logger(CoreRulesService.name);

  constructor(
    @InjectRepository(CoreRuleSetVersion)
    private readonly repo: Repository<CoreRuleSetVersion>,
    private readonly lock: AdvisoryLockService,
    private readonly audit: OpsAuditService,
  ) {}

  async list(coreName?: string): Promise<CoreRuleSetVersion[]> {
    const where = coreName ? { coreName } : {};
    return this.repo.find({
      where,
      order: { coreName: 'ASC', versionNo: 'DESC' },
    });
  }

  async create(
    coreName: string,
    rulesJson: Record<string, unknown>,
    note?: string,
    actor?: string,
  ) {
    return this.lock.withLock(coreLock(coreName), async () => {
      return this.repo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(CoreRuleSetVersion);
        const baseline = await repo.findOne({
          where: { coreName, versionNo: FACTORY_VERSION_NO },
        });
        if (!baseline) {
          throw new Error(`factory baseline missing for core=${coreName}`);
        }
        const versionNo = await this.nextVersionNo(coreName, repo);
        const sanitized = sanitizeCoreRules(coreName, rulesJson);
        const entity = repo.create({
          coreName,
          versionNo,
          rulesJson: sanitized,
          status: 'SUCCESS',
          note,
          createdBy: actor,
        });
        const saved = await repo.save(entity);
        await this.audit.logWithManager(manager, 'UPDATE_CORE', {
          targetType: 'core',
          targetName: coreName,
          status: 'SUCCESS',
          actor,
          note,
          detail: { versionNo },
        });
        this.logger.log(`Core ${coreName} saved as v1.${versionNo}`);
        return saved;
      });
    });
  }

  async rollback(coreName: string, versionNo: number, actor?: string) {
    return this.lock.withLock(coreLock(coreName), async () => {
      return this.repo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(CoreRuleSetVersion);
        const target = await repo.findOne({
          where: { coreName, versionNo },
        });
        if (!target) return null;
        const next = await this.nextVersionNo(coreName, repo);
        const entity = repo.create({
          coreName,
          versionNo: next,
          rulesJson: target.rulesJson,
          status: 'SUCCESS',
          note: `rollback to v1.${versionNo}`,
          createdBy: actor,
        });
        const saved = await repo.save(entity);
        await this.audit.logWithManager(manager, 'RESTORE_CORE_FACTORY', {
          targetType: 'core',
          targetName: coreName,
          status: 'SUCCESS',
          actor,
          note: entity.note,
          detail: { fromVersion: versionNo, newVersion: next },
        });
        this.logger.log(
          `Core ${coreName} rollback to v1.${versionNo} -> new v1.${next}`,
        );
        return saved;
      });
    });
  }

  private async nextVersionNo(
    coreName: string,
    repo: Repository<CoreRuleSetVersion> = this.repo,
  ): Promise<number> {
    const latest = await repo.findOne({
      where: { coreName },
      order: { versionNo: 'DESC' },
    });
    return latest ? latest.versionNo + 1 : FACTORY_VERSION_NO;
  }
}
