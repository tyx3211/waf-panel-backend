import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import databaseConfig from './config/database.config';
import { DatabaseModule } from './database/database.module';
import { LocksModule } from './common/locks/locks.module';
import { HealthModule } from './health/health.module';
import { OpsAuditModule } from './ops-audit/ops-audit.module';
import { VersionsModule } from './versions/versions.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CoreRulesModule } from './core-rules/core-rules.module';
import { TemplatesModule } from './templates/templates.module';
import { AuditModule } from './audit/audit.module';
import { RulesModule } from './rules/rules.module';
import wafConfig from './config/waf.config';
import { LokiModule } from './loki/loki.module';
import lokiConfig from './config/loki.config';
import { ReportsModule } from './reports/reports.module';
import { AuthModule } from './auth/auth.module';
import jwtConfig from './config/jwt.config';
import { AlertsModule } from './alerts/alerts.module';
import { UsersController } from './users/users.controller';
import { CommonModule } from './common/common.module';
import smtpConfig from './config/smtp.config';
import { WafMetricsModule } from './waf-metrics/waf-metrics.module';

import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, wafConfig, lokiConfig, jwtConfig, smtpConfig],
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'client'),
      exclude: ['/api/(.*)'],
    }),
    DatabaseModule,
    LocksModule,
    HealthModule,
    OpsAuditModule,
    VersionsModule,
    CoreRulesModule,
    TemplatesModule,
    AuditModule,
    RulesModule,
    LokiModule,
    ReportsModule,
    WafMetricsModule,
    AuthModule,
    AlertsModule,
    CommonModule,
  ],
  controllers: [AppController, UsersController],
  providers: [AppService],
})
export class AppModule {}
