import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import lokiConfig from '../config/loki.config';
import { LokiService } from './loki.service';
import { LokiController } from './loki.controller';

@Module({
  imports: [ConfigModule.forFeature(lokiConfig)],
  providers: [LokiService],
  controllers: [LokiController],
  exports: [LokiService],
})
export class LokiModule {}
