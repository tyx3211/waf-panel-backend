import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { HealthService } from '../health.service';
import { LokiService } from '../../loki/loki.service';
import { AlertMailService } from '../../alerts/alert-mail.service';

describe('HealthService', () => {
  let service: HealthService;
  let mockDataSource: jest.Mocked<DataSource>;
  let mockLokiService: jest.Mocked<LokiService>;
  let mockAlertMailService: jest.Mocked<AlertMailService>;

  beforeEach(async () => {
    mockDataSource = {
      query: jest.fn(),
    } as unknown as jest.Mocked<DataSource>;

    mockLokiService = {
      queryLogs: jest.fn(),
    } as unknown as jest.Mocked<LokiService>;

    mockAlertMailService = {
      getStatus: jest.fn(),
      verify: jest.fn(),
    } as unknown as jest.Mocked<AlertMailService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: LokiService, useValue: mockLokiService },
        { provide: AlertMailService, useValue: mockAlertMailService },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  describe('check', () => {
    it('should return ok status when all services are healthy', async () => {
      mockDataSource.query.mockResolvedValue([{ '1': 1 }]);
      mockLokiService.queryLogs.mockResolvedValue({
        data: { resultType: 'streams', result: [] },
      });
      mockAlertMailService.getStatus.mockReturnValue({
        enabled: true,
        configured: true,
        host: 'smtp.test.com',
      });
      mockAlertMailService.verify.mockResolvedValue({ ok: true });

      const result = await service.check();

      expect(result.status).toBe('ok');
      expect(result.components.db.status).toBe('up');
      expect(result.components.loki.status).toBe('up');
      expect(result.components.smtp.status).toBe('up');
    });

    it('should return unhealthy when DB is down', async () => {
      mockDataSource.query.mockRejectedValue(new Error('connection failed'));
      mockLokiService.queryLogs.mockResolvedValue({
        data: { resultType: 'streams', result: [] },
      });
      mockAlertMailService.getStatus.mockReturnValue({
        enabled: false,
        configured: false,
      });

      const result = await service.check();

      expect(result.status).toBe('unhealthy');
      expect(result.components.db.status).toBe('down');
    });

    it('should return degraded when Loki is down but DB is up', async () => {
      mockDataSource.query.mockResolvedValue([{ '1': 1 }]);
      mockLokiService.queryLogs.mockRejectedValue(new Error('loki timeout'));
      mockAlertMailService.getStatus.mockReturnValue({
        enabled: false,
        configured: false,
      });

      const result = await service.check();

      expect(result.status).toBe('degraded');
      expect(result.components.db.status).toBe('up');
      expect(result.components.loki.status).toBe('down');
    });

    it('should return unconfigured for SMTP when not enabled', async () => {
      mockDataSource.query.mockResolvedValue([{ '1': 1 }]);
      mockLokiService.queryLogs.mockResolvedValue({
        data: { resultType: 'streams', result: [] },
      });
      mockAlertMailService.getStatus.mockReturnValue({
        enabled: false,
        configured: false,
      });

      const result = await service.check();

      expect(result.components.smtp.status).toBe('unconfigured');
    });

    it('should return degraded when SMTP verify fails', async () => {
      mockDataSource.query.mockResolvedValue([{ '1': 1 }]);
      mockLokiService.queryLogs.mockResolvedValue({
        data: { resultType: 'streams', result: [] },
      });
      mockAlertMailService.getStatus.mockReturnValue({
        enabled: true,
        configured: true,
        host: 'smtp.test.com',
      });
      mockAlertMailService.verify.mockResolvedValue({
        ok: false,
        error: 'auth failed',
      });

      const result = await service.check();

      expect(result.status).toBe('degraded');
      expect(result.components.smtp.status).toBe('down');
    });
  });
});
