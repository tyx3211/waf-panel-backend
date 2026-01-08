import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreRuleSetVersion } from '../entities/core-rule-set-version.entity';
import { CoreRulesService } from './core-rules.service';
import { CoreRulesController } from './core-rules.controller';
import { LocksModule } from '../common/locks/locks.module';
import { OpsAuditModule } from '../ops-audit/ops-audit.module';
import { CoreFactoryService } from './core-factory.service';
import { CoreRulesBootstrap } from './core-rules.bootstrap';

@Module({
  imports: [
    TypeOrmModule.forFeature([CoreRuleSetVersion]),
    LocksModule,
    OpsAuditModule,
  ],
  providers: [CoreRulesService, CoreFactoryService, CoreRulesBootstrap],
  controllers: [CoreRulesController],
  exports: [CoreRulesService],
})
export class CoreRulesModule {}
