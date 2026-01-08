import { ReportsService } from '../reports.service';
import { LokiService } from '../../loki/loki.service';

describe('ReportsService', () => {
  const makeLoki = () =>
    ({
      queryWafLogs: jest.fn().mockResolvedValue({
        data: {
          resultType: 'streams',
          result: [
            {
              stream: { job: 'waf' },
              values: [
                [
                  '1700000000000000000',
                  JSON.stringify({
                    attackType: 'SQL_INJECTION',
                    country: 'CN',
                    uri: '/login',
                    clientIp: '1.1.1.1',
                    blocked: true,
                  }),
                ],
                [
                  '1700000060000000000',
                  JSON.stringify({
                    attackType: 'XSS',
                    country: 'US',
                    uri: '/search',
                    clientIp: '2.2.2.2',
                    blocked: false,
                  }),
                ],
                [
                  '1700000120000000000',
                  JSON.stringify({
                    attackType: 'SQL_INJECTION',
                    country: 'CN',
                    uri: '/login',
                    clientIp: '1.1.1.1',
                    blocked: true,
                  }),
                ],
              ],
            },
          ],
        },
      }),
    }) as unknown as LokiService;

  it('should return structured summary with aggregated metrics', async () => {
    const svc = new ReportsService(makeLoki());
    const summary = await svc.getSummary('1h');
    expect(summary.timeRange).toBe('1h');
    expect(summary.kpis.requests).toBe(3);
    expect(summary.kpis.blocks).toBe(2);
    expect(
      summary.attackTypes.find((a) => a.type === 'SQL_INJECTION')?.count,
    ).toBe(2);
    expect(summary.topUrls[0].name).toBe('/login');
    expect(summary.topAttackIps[0].name).toBe('1.1.1.1');
    expect(summary.topBlockedUrls[0].name).toBe('/login');
    expect(summary.topBlockedIps[0].name).toBe('1.1.1.1');
    expect(summary.geoWorld.top[0].name).toBe('CN');
  });

  it('should produce a pdf buffer with header', () => {
    const loki = {
      queryWafLogs: jest
        .fn()
        .mockResolvedValue({ data: { resultType: 'streams', result: [] } }),
    } as unknown as LokiService;
    const svc = new ReportsService(loki);
    return svc.getSummary().then((summary) => {
      const pdf = svc.getPdfBuffer(summary);
      const head = pdf.toString('utf8', 0, 4);
      expect(head).toBe('%PDF');
    });
  });
});
