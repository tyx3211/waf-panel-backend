import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdvisoryLockService } from '../common/locks/advisory-lock.service';
import { serverLock } from '../common/locks/lock-keys';
import {
  ServerPolicyVersion,
  VersionStatus,
} from '../entities/server-policy-version.entity';
import { OpsAuditService } from '../ops-audit/ops-audit.service';
import { OpsStatus } from '../entities/ops-audit-log.entity';

interface CreatePolicyVersionInput {
  serverName: string;
  policyJson: Record<string, unknown>;
  enabledCoreRules?: string[];
  enabledTemplates?: string[];
  note?: string;
  actor?: string;
  status?: VersionStatus;
  publishLog?: string;
}

@Injectable()
export class PolicyVersionService {
  private readonly logger = new Logger(PolicyVersionService.name);

  constructor(
    @InjectRepository(ServerPolicyVersion)
    private readonly repo: Repository<ServerPolicyVersion>,
    private readonly lock: AdvisoryLockService,
    private readonly audit: OpsAuditService,
  ) {}

  async list(serverName: string): Promise<ServerPolicyVersion[]> {
    return this.repo.find({
      where: { serverName },
      order: { versionNo: 'DESC' },
    });
  }

  async createVersion(
    input: CreatePolicyVersionInput,
  ): Promise<ServerPolicyVersion> {
    const { serverName } = input;
    return this.lock.withLock(serverLock(serverName), async () => {
      return this.repo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(ServerPolicyVersion);
        const nextVersion = await this.nextVersionNo(serverName, repo);
        const entity = repo.create({
          serverName,
          versionNo: nextVersion,
          policyJson: input.policyJson,
          enabledCoreRules: input.enabledCoreRules,
          enabledTemplates: input.enabledTemplates,
          note: input.note,
          status: input.status ?? 'SUCCESS',
          publishLog: input.publishLog,
          createdBy: input.actor,
        });
        const saved = await repo.save(entity);
        const auditStatus: OpsStatus =
          input.status === 'FAILED' ? 'FAILED' : 'SUCCESS';
        await this.audit.logWithManager(manager, 'PUBLISH_POLICY', {
          targetType: 'server',
          targetName: serverName,
          status: auditStatus,
          actor: input.actor,
          note: input.note,
          detail: { versionNo: nextVersion, status: input.status ?? 'SUCCESS' },
        });
        this.logger.log(
          `Saved policy version v1.${nextVersion} for server=${serverName}`,
        );
        return saved;
      });
    });
  }

  async rollback(
    serverName: string,
    versionNo: number,
    actor?: string,
  ): Promise<ServerPolicyVersion | null> {
    return this.lock.withLock(serverLock(serverName), async () => {
      return this.repo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(ServerPolicyVersion);
        const latest = await repo.findOne({
          where: { serverName },
          order: { versionNo: 'DESC' },
        });
        const target = await repo.findOne({
          where: { serverName, versionNo },
        });
        if (!target) {
          return null;
        }
        const currentNext = await this.nextVersionNo(serverName, repo);
        const rollbackVersion = repo.create({
          serverName,
          versionNo: currentNext,
          policyJson: target.policyJson,
          enabledCoreRules: target.enabledCoreRules,
          enabledTemplates: target.enabledTemplates,
          note: `rollback to v1.${versionNo}`,
          status: 'SUCCESS',
          createdBy: actor,
        });
        const saved = await repo.save(rollbackVersion);
        if (latest && latest.id !== saved.id) {
          latest.status = 'ROLLED_BACK';
          latest.note = latest.note ?? `rolled back by v1.${currentNext}`;
          await repo.save(latest);
        }
        await this.audit.logWithManager(manager, 'ROLLBACK_POLICY', {
          targetType: 'server',
          targetName: serverName,
          status: 'SUCCESS',
          actor,
          note: rollbackVersion.note,
          detail: {
            fromVersion: versionNo,
            newVersion: currentNext,
            steps: [],
            rollbackSteps: [],
          },
        });
        this.logger.log(
          `Rollback server=${serverName} to v1.${versionNo} -> new v1.${currentNext}`,
        );
        return saved;
      });
    });
  }

  async findByVersionNo(
    serverName: string,
    versionNo: number,
  ): Promise<ServerPolicyVersion | null> {
    return this.repo.findOne({
      where: { serverName, versionNo },
    });
  }

  async findLatest(serverName: string): Promise<ServerPolicyVersion | null> {
    return this.repo.findOne({
      where: { serverName },
      order: { versionNo: 'DESC' },
    });
  }

  private async nextVersionNo(
    serverName: string,
    repo: Repository<ServerPolicyVersion> = this.repo,
  ): Promise<number> {
    const latest = await repo.findOne({
      where: { serverName },
      order: { versionNo: 'DESC' },
    });
    return latest ? latest.versionNo + 1 : 1;
  }
}
