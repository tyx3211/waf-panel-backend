import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServerPolicyVersion } from '../entities/server-policy-version.entity';
import { TemplateRuleSetVersion } from '../entities/template-rule-set-version.entity';
import { CoreRuleSetVersion } from '../entities/core-rule-set-version.entity';
import { PolicyVersionService } from './policy-version.service';
import { LocksModule } from '../common/locks/locks.module';
import { OpsAuditModule } from '../ops-audit/ops-audit.module';
import { VersionsController } from './versions.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServerPolicyVersion,
      TemplateRuleSetVersion,
      CoreRuleSetVersion,
    ]),
    LocksModule,
    OpsAuditModule,
  ],
  providers: [PolicyVersionService],
  controllers: [VersionsController],
  exports: [PolicyVersionService],
})
export class VersionsModule {}
