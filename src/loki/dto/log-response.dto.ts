import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LokiLogStreamDto {
  @ApiProperty({
    description: 'Loki 标签集合',
    type: 'object',
    additionalProperties: true,
  })
  stream!: Record<string, string>;

  @ApiProperty({
    description: '日志条目（[时间戳ns, 原始行]）',
    type: 'array',
    items: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      maxItems: 2,
    },
  })
  values!: Array<[string, string]>;
}

export class LokiLogsResponseDto {
  @ApiProperty({ description: '结果类型', example: 'streams' })
  resultType!: string;

  @ApiProperty({ description: '日志流结果', type: [LokiLogStreamDto] })
  result!: LokiLogStreamDto[];

  @ApiPropertyOptional({ description: 'Loki 警告信息' })
  warnings?: string[];
}

export class WafStatsSummaryDto {
  @ApiProperty({ description: '总请求数', example: 1200 })
  requests!: number;

  @ApiProperty({ description: '拦截数', example: 312 })
  blocks!: number;

  @ApiProperty({ description: '拦截率', example: 0.26 })
  blockRate!: number;

  @ApiProperty({ description: '独立 IP 数', example: 87 })
  uniqueIps!: number;

  @ApiProperty({ description: '攻击 IP 数', example: 36 })
  attackIps!: number;

  @ApiProperty({ description: '动态封禁数', example: 120 })
  dynamicBlocks!: number;

  @ApiProperty({ description: '黑名单命中数', example: 45 })
  blacklistHits!: number;
}

export class AttackTypeCountDto {
  @ApiProperty({ description: '攻击类型', example: 'SQL_INJECTION' })
  type!: string;

  @ApiProperty({ description: '数量', example: 18 })
  count!: number;
}

export class ActionCountDto {
  @ApiProperty({ description: '动作', example: 'BLOCK' })
  action!: string;

  @ApiProperty({ description: '数量', example: 18 })
  count!: number;
}

export class WafStatsResponseDto {
  @ApiProperty({ description: '统计摘要', type: WafStatsSummaryDto })
  summary!: WafStatsSummaryDto;

  @ApiProperty({ description: '按攻击类型统计', type: [AttackTypeCountDto] })
  byAttackType!: AttackTypeCountDto[];

  @ApiProperty({ description: '按动作统计', type: [ActionCountDto] })
  byAction!: ActionCountDto[];

  @ApiPropertyOptional({ description: 'Loki 警告信息' })
  warnings?: string[];
}

export class AccessStatsSummaryDto {
  @ApiProperty({ description: '访问请求数', example: 6800 })
  requests!: number;

  @ApiProperty({ description: '拦截数', example: 1500 })
  blocks!: number;

  @ApiProperty({ description: '独立 IP 数', example: 600 })
  uniqueIps!: number;

  @ApiProperty({ description: '4xx 数量', example: 120 })
  status4xx!: number;

  @ApiProperty({ description: '5xx 数量', example: 10 })
  status5xx!: number;

  @ApiProperty({ description: '平均 QPS', example: 15.2 })
  qpsAvg!: number;
}

export class HostCountDto {
  @ApiProperty({ description: '站点/域名', example: 'example1.com' })
  host!: string;

  @ApiProperty({ description: '请求数', example: 1200 })
  requests!: number;

  @ApiProperty({ description: '拦截数', example: 120 })
  blocks!: number;
}

export class StatusCountDto {
  @ApiProperty({ description: '状态码/上游状态', example: '200' })
  status!: string;

  @ApiProperty({ description: '数量', example: 120 })
  count!: number;
}

export class DistributionStatsDto {
  @ApiProperty({ description: '平均值', example: 120 })
  avg!: number;

  @ApiProperty({ description: 'P95', example: 240 })
  p95!: number;

  @ApiProperty({ description: '最大值', example: 500 })
  max!: number;
}

export class AccessStatsResponseDto {
  @ApiProperty({ description: '统计摘要', type: AccessStatsSummaryDto })
  summary!: AccessStatsSummaryDto;

  @ApiProperty({ description: '按站点统计', type: [HostCountDto] })
  byHost!: HostCountDto[];

  @ApiProperty({ description: '按上游状态统计', type: [StatusCountDto] })
  byUpstreamStatus!: StatusCountDto[];

  @ApiProperty({ description: '请求体长度分布', type: DistributionStatsDto })
  reqLen!: DistributionStatsDto;

  @ApiProperty({
    description: '上游响应耗时分布（秒）',
    type: DistributionStatsDto,
  })
  upRt!: DistributionStatsDto;

  @ApiPropertyOptional({ description: 'Loki 警告信息' })
  warnings?: string[];
}

export class AccessTimeseriesPointDto {
  @ApiProperty({
    description: '时间点（ISO）',
    example: '2026-01-01T00:00:00Z',
  })
  ts!: string;

  @ApiProperty({ description: '请求数', example: 120 })
  requests!: number;

  @ApiProperty({ description: '拦截数', example: 12 })
  blocks!: number;
}

export class AccessTimeseriesResponseDto {
  @ApiProperty({ description: '间隔秒数', example: 60 })
  intervalSeconds!: number;

  @ApiProperty({ description: '时序点', type: [AccessTimeseriesPointDto] })
  points!: AccessTimeseriesPointDto[];

  @ApiPropertyOptional({ description: 'Loki 警告信息' })
  warnings?: string[];
}

export class GeoHeatmapEntryDto {
  @ApiProperty({ description: '区域编码', example: 'CN' })
  code!: string;

  @ApiProperty({ description: '数量', example: 120 })
  count!: number;
}

export class GeoTopEntryDto {
  @ApiProperty({ description: '区域名称', example: '浙江' })
  name!: string;

  @ApiProperty({ description: '数量', example: 120 })
  count!: number;
}

export class GeoStatsResponseDto {
  @ApiProperty({ description: '模式', enum: ['visit', 'block'] })
  mode!: 'visit' | 'block';

  @ApiProperty({ description: '范围', enum: ['world', 'china'] })
  scope!: 'world' | 'china';

  @ApiProperty({ description: '热力图数据', type: [GeoHeatmapEntryDto] })
  heatmap!: GeoHeatmapEntryDto[];

  @ApiProperty({ description: 'Top 列表', type: [GeoTopEntryDto] })
  top!: GeoTopEntryDto[];

  @ApiPropertyOptional({ description: 'Loki 警告信息' })
  warnings?: string[];
}
