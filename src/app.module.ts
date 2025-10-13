import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WafModule } from './waf/waf.module';
import { WafMetricsModule } from './waf-metrics/waf-metrics.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), WafModule, WafMetricsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
