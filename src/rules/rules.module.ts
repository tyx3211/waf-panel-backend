import { Module, forwardRef } from '@nestjs/common';
import { LocksModule } from '../common/locks/locks.module';
import { OpsAuditModule } from '../ops-audit/ops-audit.module';
import { VersionsModule } from '../versions/versions.module';
import { PolicyPublishService } from './policy-publish.service';
import { RulesController } from './rules.controller';
import { RulesFilesystemService } from './rules-filesystem.service';
import { NginxCommandService } from './nginx-command.service';
import { NginxConfigService } from './nginx-config.service';
import { ConfigModule } from '@nestjs/config';
import wafConfig from '../config/waf.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreRuleSetVersion } from '../entities/core-rule-set-version.entity';
import { TemplateRuleSetVersion } from '../entities/template-rule-set-version.entity';

@Module({
  imports: [
    ConfigModule.forFeature(wafConfig),
    LocksModule,
    OpsAuditModule,
    forwardRef(() => VersionsModule),
    TypeOrmModule.forFeature([CoreRuleSetVersion, TemplateRuleSetVersion]),
  ],
  providers: [
    PolicyPublishService,
    RulesFilesystemService,
    NginxCommandService,
    NginxConfigService,
  ],
  controllers: [RulesController],
  exports: [PolicyPublishService, RulesFilesystemService],
})
export class RulesModule {}
