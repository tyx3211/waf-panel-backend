import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  OpsAuditLog,
  OpsActionType,
  OpsStatus,
} from '../entities/ops-audit-log.entity';

@Injectable()
export class OpsAuditService {
  constructor(
    @InjectRepository(OpsAuditLog)
    private readonly repo: Repository<OpsAuditLog>,
  ) {}

  async log(
    actionType: OpsActionType,
    params: {
      targetType: string;
      targetName?: string;
      status: OpsStatus;
      actor?: string;
      note?: string;
      detail?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.write(this.repo, actionType, params);
  }

  async logWithManager(
    manager: EntityManager,
    actionType: OpsActionType,
    params: {
      targetType: string;
      targetName?: string;
      status: OpsStatus;
      actor?: string;
      note?: string;
      detail?: Record<string, unknown>;
    },
  ): Promise<void> {
    const repo = manager.getRepository(OpsAuditLog);
    await this.write(repo, actionType, params);
  }

  private async write(
    repo: Repository<OpsAuditLog>,
    actionType: OpsActionType,
    params: {
      targetType: string;
      targetName?: string;
      status: OpsStatus;
      actor?: string;
      note?: string;
      detail?: Record<string, unknown>;
    },
  ): Promise<void> {
    const entry = repo.create({
      actionType,
      targetType: params.targetType,
      targetName: params.targetName,
      status: params.status,
      actor: params.actor,
      note: params.note,
      detail: params.detail,
    });
    await repo.save(entry);
  }
}
