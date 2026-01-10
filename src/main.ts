import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ResponseInterceptor } from './common/http/response.interceptor';
import { PerformanceInterceptor } from './common/interceptors/performance.interceptor';
import { AllExceptionsFilter } from './common/http/http-exception.filter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { applyEnvelope } from './common/http/openapi-envelope';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );
  app.useGlobalInterceptors(
    new ResponseInterceptor(),
    new PerformanceInterceptor(),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = new DocumentBuilder()
    .setTitle('WAF 控制面 API')
    .setVersion('v1')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  applyEnvelope(document);
  SwaggerModule.setup('/api/v1/docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
