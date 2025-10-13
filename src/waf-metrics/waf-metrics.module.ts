import { Module } from '@nestjs/common';
import { WafMetricsService } from './waf-metrics.service';
import { WafMetricsController } from './waf-metrics.controller';

@Module({
  providers: [WafMetricsService],
  controllers: [WafMetricsController],
})
export class WafMetricsModule {}


