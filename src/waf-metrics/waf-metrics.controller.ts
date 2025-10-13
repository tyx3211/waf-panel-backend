import { Controller, Get, Query } from '@nestjs/common';
import { WafMetricsService } from './waf-metrics.service';

@Controller('metrics')
export class WafMetricsController {
  constructor(private readonly svc: WafMetricsService) {}

  @Get('series')
  series(@Query('window') window: '5m' | '1h' | '24h' = '5m') {
    return this.svc.getSeries(window);
  }

  @Get('summary')
  summary(@Query('window') window: '5m' | '1h' | '24h' = '5m') {
    return { window, ...this.svc.getSummary(window) };
  }
}


