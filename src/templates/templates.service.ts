import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdvisoryLockService } from '../common/locks/advisory-lock.service';
import { TemplateRuleSetVersion } from '../entities/template-rule-set-version.entity';
import { OpsAuditService } from '../ops-audit/ops-audit.service';
import { templateLock } from '../common/locks/lock-keys';
import {
  sanitizeTemplateRules,
  RuleValidationError,
} from '../common/rules/rules-validation';
import { RulesFilesystemService } from '../rules/rules-filesystem.service';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    @InjectRepository(TemplateRuleSetVersion)
    private readonly repo: Repository<TemplateRuleSetVersion>,
    private readonly lock: AdvisoryLockService,
    private readonly audit: OpsAuditService,
    private readonly files: RulesFilesystemService,
  ) {}

  async list(templateName?: string) {
    const where = templateName ? { templateName } : {};
    return this.repo.find({
      where,
      order: { templateName: 'ASC', versionNo: 'DESC' },
    });
  }

  async create(
    templateName: string,
    rulesJson: Record<string, unknown>,
    note?: string,
    actor?: string,
  ) {
    return this.lock.withLock(templateLock(templateName), async () => {
      const sanitized = sanitizeTemplateRules(templateName, rulesJson);
      this.assertNoExtends(sanitized);

      return this.repo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(TemplateRuleSetVersion);
        const versionNo = await this.nextVersion(templateName, repo);
        const entity = repo.create({
          templateName,
          versionNo,
          rulesJson: sanitized,
          status: 'SUCCESS',
          note,
          createdBy: actor,
        });
        const saved = await repo.save(entity);
        
        // Write to filesystem
        this.files.writeTemplate(templateName, sanitized);

        await this.audit.logWithManager(manager, 'UPDATE_TEMPLATE', {
          targetType: 'template',
          targetName: templateName,
          status: 'SUCCESS',
          actor,
          note,
          detail: { versionNo },
        });
        this.logger.log(`Template ${templateName} saved as v1.${versionNo}`);
        return saved;
      });
    });
  }

  async rollback(templateName: string, versionNo: number, actor?: string) {
    return this.lock.withLock(templateLock(templateName), async () => {
      return this.repo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(TemplateRuleSetVersion);
        const target = await repo.findOne({
          where: { templateName, versionNo },
        });
        if (!target) return null;
        const next = await this.nextVersion(templateName, repo);
        const entity = repo.create({
          templateName,
          versionNo: next,
          rulesJson: target.rulesJson,
          status: 'SUCCESS',
          note: `rollback to v1.${versionNo}`,
          createdBy: actor,
        });
        const saved = await repo.save(entity);

        // Write to filesystem
        this.files.writeTemplate(templateName, target.rulesJson as Record<string, unknown>);

        await this.audit.logWithManager(manager, 'UPDATE_TEMPLATE', {
          targetType: 'template',
          targetName: templateName,
          status: 'SUCCESS',
          actor,
          note: entity.note,
          detail: { fromVersion: versionNo, newVersion: next },
        });
        this.logger.log(
          `Template ${templateName} rollback to v1.${versionNo} -> new v1.${next}`,
        );
        return saved;
      });
    });
  }

  private async nextVersion(
    templateName: string,
    repo: Repository<TemplateRuleSetVersion> = this.repo,
  ): Promise<number> {
    const latest = await repo.findOne({
      where: { templateName },
      order: { versionNo: 'DESC' },
    });
    return latest ? latest.versionNo + 1 : 1;
  }

  // 模板不允许再引用其他文件，保持一级引用
  private assertNoExtends(rulesJson: Record<string, unknown>) {
    const meta = rulesJson?.meta as Record<string, unknown> | undefined;
    if (meta && meta['extends']) {
      throw new RuleValidationError('template is not allowed to use extends');
    }
  }

  async delete(templateName: string, actor?: string) {
    return this.lock.withLock(templateLock(templateName), async () => {
      return this.repo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(TemplateRuleSetVersion);
        
        // Delete all versions from DB
        const result = await repo.delete({ templateName });
        
        // Delete file from disk
        this.files.deleteTemplate(templateName);

        await this.audit.logWithManager(manager, 'UPDATE_TEMPLATE', {
          targetType: 'template',
          targetName: templateName,
          status: 'SUCCESS',
          actor,
          note: 'Deleted template',
          detail: { affected: result.affected },
        });

        this.logger.log(`Template ${templateName} deleted (versions: ${result.affected})`);
        return { deleted: true };
      });
    });
  }
}
