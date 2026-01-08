import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { Repository } from 'typeorm';
import { coreLock } from '../common/locks/lock-keys';
import { AdvisoryLockService } from '../common/locks/advisory-lock.service';
import { CoreRuleSetVersion } from '../entities/core-rule-set-version.entity';
import { sanitizeCoreRules } from '../common/rules/rules-validation';
import { FACTORY_VERSION_NO, FACTORY_NOTE } from '../common/rules/consts';

@Injectable()
export class CoreFactoryService {
  private readonly logger = new Logger(CoreFactoryService.name);

  constructor(
    @InjectRepository(CoreRuleSetVersion)
    private readonly repo: Repository<CoreRuleSetVersion>,
    private readonly lock: AdvisoryLockService,
  ) {}

  /**
   * 将出厂 core JSON 初始化为 v1.0，只读基线
   * @param factoryDir 出厂 core 目录（只读，例如 WAF_RULES_JSON/core）
   * @param managedDir 可编辑目录（受控，例如 WAF_RULES_JSON/managed-core）
   */
  async seedFactoryVersions(
    factoryDir: string,
    managedDir: string,
  ): Promise<void> {
    if (!fs.existsSync(factoryDir)) {
      this.logger.warn(`factory core dir not found: ${factoryDir}`);
      return;
    }
    const files = fs.readdirSync(factoryDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const coreName = path.basename(file, '.json');
      const raw = fs.readFileSync(path.join(factoryDir, file), 'utf8');
      const json = JSON.parse(raw) as Record<string, unknown>;
      const sanitized = sanitizeCoreRules(coreName, json);
      await this.seedOne(coreName, sanitized, managedDir);
    }
  }

  private async seedOne(
    coreName: string,
    rulesJson: Record<string, unknown>,
    managedDir: string,
  ) {
    const key = coreLock(coreName);
    await this.lock.withLock(key, async () => {
      const existing = await this.repo.findOne({
        where: { coreName, versionNo: FACTORY_VERSION_NO },
      });
      if (existing) {
        return;
      }
      const factoryVersion = this.repo.create({
        coreName,
        versionNo: FACTORY_VERSION_NO,
        rulesJson,
        status: 'SUCCESS',
        note: FACTORY_NOTE,
      });
      await this.repo.save(factoryVersion);
      await this.writeManagedFile(coreName, rulesJson, managedDir);
      this.logger.log(
        `Seed factory core ${coreName} -> v1.${FACTORY_VERSION_NO}`,
      );
    });
  }

  private async writeManagedFile(
    coreName: string,
    rulesJson: Record<string, unknown>,
    managedDir: string,
  ) {
    const targetPath = path.join(managedDir, `${coreName}.json`);
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.writeFile(targetPath, JSON.stringify(rulesJson, null, 2), 'utf8');
  }
}
