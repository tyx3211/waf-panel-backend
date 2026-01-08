import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CoreFactoryService } from './core-factory.service';
import { type WafConfig } from '../config/waf.config';

@Injectable()
export class CoreRulesBootstrap implements OnModuleInit {
  private readonly logger = new Logger(CoreRulesBootstrap.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly factory: CoreFactoryService,
  ) {}

  async onModuleInit(): Promise<void> {
    const cfg = this.configService.get<WafConfig>('waf');
    if (!cfg) {
      this.logger.warn('waf config missing, skip core factory seed');
      return;
    }
    await this.factory.seedFactoryVersions(cfg.coreDir, cfg.coreManagedDir);
  }
}
