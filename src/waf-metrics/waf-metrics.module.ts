import { Module } from '@nestjs/common';
import { WafMetricsService } from './waf-metrics.service';
import { WafMetricsController } from './waf-metrics.controller';

@Module({
  providers: [WafMetricsService],
  controllers: [WafMetricsController],
  exports: [WafMetricsService],
})
export class WafMetricsModule {}
