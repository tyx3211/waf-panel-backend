import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const isSilent = process.env.NEST_LOG_SILENT === '1' || process.env.NEST_LOG_SILENT === 'true';
  const app = await NestFactory.create(AppModule, {
    logger: isSilent ? false : undefined,
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
