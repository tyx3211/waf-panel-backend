import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TemplateRuleSetVersion } from '../entities/template-rule-set-version.entity';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';
import { LocksModule } from '../common/locks/locks.module';
import { OpsAuditModule } from '../ops-audit/ops-audit.module';

import { RulesModule } from '../rules/rules.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TemplateRuleSetVersion]),
    LocksModule,
    OpsAuditModule,
    RulesModule,
  ],
  providers: [TemplatesService],
  controllers: [TemplatesController],
  exports: [TemplatesService],
})
export class TemplatesModule {}
