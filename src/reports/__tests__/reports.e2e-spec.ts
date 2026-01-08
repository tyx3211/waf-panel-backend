import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ReportsModule } from '../reports.module';
import { ResponseInterceptor } from '../../common/http/response.interceptor';
import { AllExceptionsFilter } from '../../common/http/http-exception.filter';

describe('Reports (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ReportsModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/reports/waf returns envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/reports/waf')
      .expect(200);
    expect(res.body).toHaveProperty('code', 0);
    expect(res.body).toHaveProperty('data');
  });

  it('GET /api/v1/reports/waf/export returns pdf without envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/reports/waf/export')
      .expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    // envelope 未包裹：直接返回 Buffer
    expect(res.body).toBeInstanceOf(Buffer);
  });
});
