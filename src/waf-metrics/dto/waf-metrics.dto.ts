import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export class MetricPointDto {
  @ApiProperty({ description: '时间戳 (毫秒)' })
  ts!: number;
  @ApiProperty({ description: '总请求数' })
  req!: number;
  @ApiProperty({ description: '拦截数' })
  block!: number;
}

export class MetricSummaryDto {
  @ApiProperty({ description: '总请求' })
  req!: number;
  @ApiProperty({ description: '拦截数' })
  block!: number;
  @ApiProperty({ description: '4xx 错误' })
  s4xx!: number;
  @ApiProperty({ description: '5xx 错误' })
  s5xx!: number;
  @ApiProperty({
    enum: ['visit', 'block'],
    default: 'visit',
    description: '统计模式：访问量或拦截量',
    required: false,
  })
  @IsEnum(['visit', 'block'])
  @IsOptional()
  mode?: 'visit' | 'block';
}

export class WafSummaryResponseDto {
  @ApiProperty({ type: MetricSummaryDto })
  summary!: MetricSummaryDto;
  @ApiProperty({ type: [MetricPointDto] })
  series!: MetricPointDto[];
}

export class GeoEntryDto {
  @ApiProperty()
  name!: string;
  @ApiProperty()
  value!: number;
}

export class WafGeoResponseDto {
  @ApiProperty({ type: [GeoEntryDto] })
  world!: GeoEntryDto[];
  @ApiProperty({ type: [GeoEntryDto] })
  china!: GeoEntryDto[];
}

export class TopEntryDto {
  @ApiProperty()
  name!: string;
  @ApiProperty()
  count!: number;
}

export class WafTopResponseDto {
  @ApiProperty({ type: [TopEntryDto] })
  topIps!: TopEntryDto[];
  @ApiProperty({ type: [TopEntryDto] })
  topUrls!: TopEntryDto[];
  @ApiProperty({ type: [TopEntryDto] })
  attackTypes!: TopEntryDto[];
}
