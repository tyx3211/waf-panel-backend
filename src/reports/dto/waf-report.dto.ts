import { ApiProperty } from '@nestjs/swagger';

export class WafReportKpiDto {
  @ApiProperty({ description: '请求总数' })
  requests!: number;

  @ApiProperty({ description: '拦截总数' })
  blocks!: number;

  @ApiProperty({ description: '独立访客 IP 数' })
  uniqueIps!: number;

  @ApiProperty({ description: '独立攻击 IP 数' })
  attackIps!: number;

  @ApiProperty({ description: '拦截率（0-1 小数）' })
  blockRate!: number;
}

export class TimeSeriesPointDto {
  @ApiProperty({ description: '时间戳（ms）' })
  ts!: number;

  @ApiProperty({ description: '请求数' })
  requests!: number;

  @ApiProperty({ description: '拦截数' })
  blocks!: number;
}

export class AttackBreakdownDto {
  @ApiProperty({ description: '攻击类型', example: 'SQL_INJECTION' })
  type!: string;

  @ApiProperty({ description: '数量' })
  count!: number;
}

export class GeoEntryDto {
  @ApiProperty({ description: '区域名称' })
  name!: string;

  @ApiProperty({ description: '数量' })
  count!: number;
}

export class GeoSectionDto {
  @ApiProperty({ description: '模式：visit | block', example: 'visit' })
  mode!: 'visit' | 'block';

  @ApiProperty({ description: '范围：world | china', example: 'world' })
  scope!: 'world' | 'china';

  @ApiProperty({ description: '热点数据', type: [GeoEntryDto] })
  heatmap!: GeoEntryDto[];

  @ApiProperty({ description: 'Top 榜单', type: [GeoEntryDto] })
  top!: GeoEntryDto[];
}

export class ReportSectionDto {
  @ApiProperty({ description: '标题' })
  title!: string;

  @ApiProperty({ description: '描述', required: false })
  description?: string;
}

export class WafReportSummaryDto {
  @ApiProperty({ description: '统计时间范围，如 5m/1h/24h', example: '24h' })
  timeRange!: string;

  @ApiProperty({
    description: '生成时间 ISO 字符串',
    example: '2026-01-03T01:23:45Z',
  })
  generatedAt!: string;

  @ApiProperty({ description: '核心指标', type: WafReportKpiDto })
  kpis!: WafReportKpiDto;

  @ApiProperty({
    description: '请求/拦截时序（用于折线图）',
    type: [TimeSeriesPointDto],
  })
  timeline!: TimeSeriesPointDto[];

  @ApiProperty({ description: '攻击类型分布', type: [AttackBreakdownDto] })
  attackTypes!: AttackBreakdownDto[];

  @ApiProperty({ description: '世界热点', type: GeoSectionDto })
  geoWorld!: GeoSectionDto;

  @ApiProperty({ description: '国内热点', type: GeoSectionDto })
  geoChina!: GeoSectionDto;

  @ApiProperty({
    description: '高频 URL 榜单',
    type: [GeoEntryDto],
    example: [
      { name: '/login', count: 120 },
      { name: '/api/upload', count: 35 },
    ],
  })
  topUrls!: GeoEntryDto[];

  @ApiProperty({
    description: '高频攻击 IP 榜单',
    type: [GeoEntryDto],
    example: [{ name: '1.1.1.1', count: 30 }],
  })
  topAttackIps!: GeoEntryDto[];

  @ApiProperty({
    description: '高频拦截 URL 榜单',
    type: [GeoEntryDto],
    example: [{ name: '/admin', count: 12 }],
  })
  topBlockedUrls!: GeoEntryDto[];

  @ApiProperty({
    description: '高频拦截 IP 榜单',
    type: [GeoEntryDto],
    example: [{ name: '2.2.2.2', count: 7 }],
  })
  topBlockedIps!: GeoEntryDto[];
}
