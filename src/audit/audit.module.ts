import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OpsAuditLog } from '../entities/ops-audit-log.entity';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([OpsAuditLog])],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
