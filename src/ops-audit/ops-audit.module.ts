import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OpsAuditLog } from '../entities/ops-audit-log.entity';
import { OpsAuditService } from './ops-audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([OpsAuditLog])],
  providers: [OpsAuditService],
  exports: [OpsAuditService],
})
export class OpsAuditModule {}
