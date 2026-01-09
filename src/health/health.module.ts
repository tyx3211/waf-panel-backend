import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { LokiModule } from '../loki/loki.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [LokiModule, AlertsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
