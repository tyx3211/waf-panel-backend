import { Controller, Get, Query } from '@nestjs/common';
import { WafService } from './waf.service';

@Controller('waf')
export class WafController {
  constructor(private readonly waf: WafService) {}

  @Get('status')
  status() {
    return {
      paths: this.waf.getConfiguredPaths(),
      files: this.waf.getStatus(),
    };
  }

  @Get('logs/tail')
  tail(
    @Query('source') source: 'auto' | 'module' | 'access' = 'auto',
    @Query('lines') linesRaw?: string,
  ) {
    const lines = Math.max(1, Math.min(1000, Number(linesRaw ?? '100') || 100));
    const result = this.waf.tailLogs({ source, lines });
    return result;
  }
}
