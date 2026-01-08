import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { CommonModule } from '../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { OpsAuditModule } from '../ops-audit/ops-audit.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertConfigEntity } from '../entities/alert-config.entity';
import { AlertSendLog } from '../entities/alert-send-log.entity';
import { AlertMailService } from './alert-mail.service';
import { LocksModule } from '../common/locks/locks.module';

@Module({
  imports: [
    AuthModule,
    CommonModule,
    OpsAuditModule,
    LocksModule,
    TypeOrmModule.forFeature([AlertConfigEntity, AlertSendLog]),
  ],
  controllers: [AlertsController],
  providers: [AlertsService, AlertMailService],
})
export class AlertsModule {}
