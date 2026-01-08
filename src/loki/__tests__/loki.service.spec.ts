import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { LokiService } from '../loki.service';

jest.mock('axios');

describe('LokiService', () => {
  const getMock = jest.fn();

  beforeEach(() => {
    (axios.create as jest.Mock).mockReturnValue({ get: getMock });
    getMock.mockReset();
  });

  it('returns empty when loki url missing', async () => {
    const cs = {
      get: jest.fn().mockReturnValue({ url: '' }),
    } as unknown as ConfigService;
    const svc = new LokiService(cs);
    const res = await svc.queryLogs({});
    expect(res.data).toEqual({ resultType: 'streams', result: [] });
  });

  it('queries loki and returns data', async () => {
    const cs = {
      get: jest.fn().mockReturnValue({
        url: 'http://loki',
        timeoutMs: 1000,
        maxLimit: 1000,
      }),
    } as any;
    const svc = new LokiService(cs);
    getMock.mockResolvedValue({
      data: { data: { resultType: 'streams', result: [] } },
    });
    const res = await svc.queryLogs({ query: '{job="x"}' });
    expect(getMock).toHaveBeenCalled();
    expect(res.data).toEqual({ resultType: 'streams', result: [] });
  });

  it('handles error and returns warnings', async () => {
    const cs = {
      get: jest.fn().mockReturnValue({
        url: 'http://loki',
        timeoutMs: 1000,
        maxLimit: 1000,
      }),
    } as any;
    const svc = new LokiService(cs);
    getMock.mockRejectedValue(new Error('boom'));
    const res = await svc.queryLogs({ query: '{job="x"}' });
    expect(res.data).toEqual({ resultType: 'streams', result: [] });
    expect(res.warnings?.[0]).toContain('boom');
  });
});
