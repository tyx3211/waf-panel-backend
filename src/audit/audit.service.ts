import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, MoreThanOrEqual, Repository } from 'typeorm';
import {
  OpsActionType,
  OpsAuditLog,
  OpsStatus,
} from '../entities/ops-audit-log.entity';

interface ListParams {
  timeRange?: string;
  actor?: string;
  actionType?: string;
  target?: string;
  status?: string;
  limit?: number;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(OpsAuditLog)
    private readonly repo: Repository<OpsAuditLog>,
  ) {}

  async list(params: ListParams) {
    const where: FindOptionsWhere<OpsAuditLog> = {};

    if (params.actor) {
      where.actor = params.actor;
    }
    if (params.actionType) {
      where.actionType = params.actionType as OpsActionType;
    }
    if (params.target) {
      where.targetName = params.target;
    }
    if (params.status) {
      where.status = params.status as OpsStatus;
    }

    if (params.timeRange) {
      const now = new Date();
      let from: Date | null = null;
      switch (params.timeRange) {
        case '1h':
          from = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case '24h':
          from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        default:
          break;
      }
      if (from) {
        where.createdAt = MoreThanOrEqual(from);
      }
    }

    const limit = params.limit && params.limit > 0 ? params.limit : 50;

    return this.repo.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async detail(id: number) {
    return this.repo.findOne({ where: { id } });
  }
}
