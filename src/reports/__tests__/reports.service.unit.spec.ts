import { ReportsService } from '../reports.service';
import { LokiService } from '../../loki/loki.service';

describe('ReportsService', () => {
  const makeLoki = () =>
    ({
      queryWafStats: jest.fn().mockResolvedValue({
        summary: {
          requests: 100,
          blocks: 20,
          uniqueIps: 50,
          attackIps: 10,
          blockRate: 0.2,
        },
        byAttackType: [
          { type: 'SQL_INJECTION', count: 15 },
          { type: 'XSS', count: 5 },
        ],
      }),
      queryWafTimeline: jest.fn().mockResolvedValue([
        { ts: 1700000000000, requests: 50, blocks: 10 },
        { ts: 1700000060000, requests: 50, blocks: 10 },
      ]),
      queryWafTopN: jest.fn().mockImplementation((base, field) => {
        if (field === 'clientIp') {
          return Promise.resolve([
            { name: '1.1.1.1', count: 10 },
            { name: '2.2.2.2', count: 5 },
          ]);
        }
        if (field === 'uri') {
          return Promise.resolve([
            { name: '/login', count: 15 },
            { name: '/api', count: 5 },
          ]);
        }
        return Promise.resolve([]);
      }),
      queryGeo: jest.fn().mockImplementation((q, scope) => ({
        mode: q.mode,
        scope,
        heatmap: [{ code: 'CN', count: 50 }],
        top: [{ name: 'China', count: 50 }],
      })),
    }) as unknown as LokiService;

  it('should return structured summary with aggregated metrics', async () => {
    const svc = new ReportsService(makeLoki());
    const summary = await svc.getSummary('1h');

    expect(summary.timeRange).toBe('1h');
    expect(summary.kpis.requests).toBe(100);
    expect(summary.kpis.blocks).toBe(20);
    expect(summary.kpis.blockRate).toBe(0.2);
    expect(summary.attackTypes).toHaveLength(2);
    expect(summary.attackTypes[0].type).toBe('SQL_INJECTION');
    expect(summary.timeline).toHaveLength(2);
    expect(summary.topAttackIps[0].name).toBe('1.1.1.1');
    expect(summary.topBlockedUrls[0].name).toBe('/login');
    expect(summary.geoWorld.top[0].name).toBe('China');
  });
});
