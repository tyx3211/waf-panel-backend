import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { WafMetricsService } from './waf-metrics.service';
import {
  ApiTags,
  ApiOperation,
  ApiProperty,
  ApiOkResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { WafGeoResponseDto, WafSummaryResponseDto, WafTopResponseDto } from './dto/waf-metrics.dto';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { IsEnum, IsOptional } from 'class-validator';

class MetricsQueryDto {
  @ApiProperty({
    enum: ['5m', '1h', '24h', '7d'],
    default: '1h',
    description: '查询时间范围',
  })
  @IsEnum(['5m', '1h', '24h', '7d'])
  @IsOptional()
  range?: '5m' | '1h' | '24h' | '7d';

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

@ApiTags('实时指标')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('waf-metrics')
export class WafMetricsController {
  constructor(private readonly metricsService: WafMetricsService) {}

  @Get('summary')
  @ApiOperation({
    summary: '获取流量摘要和趋势图',
    description:
      '返回指定时间范围内的请求总数、拦截总数、状态码分布及趋势点位数据。',
  })
  @ApiOkResponse({ type: WafSummaryResponseDto })
  getSummary(@Query() query: MetricsQueryDto): WafSummaryResponseDto {
    return this.metricsService.getSummary(query.range || '1h');
  }

  @Get('top')
  @ApiOperation({
    summary: '获取 Top 统计 (IP, URL, 攻击类型)',
    description: '基于内存统计返回拦截量最高的 IP、URL 和攻击类型分布。',
  })
  @ApiOkResponse({ type: WafTopResponseDto })
  getTop(@Query() query: MetricsQueryDto): WafTopResponseDto {
    return this.metricsService.getTopStats(query.range);
  }

  @Get('geo')
  @ApiOperation({
    summary: '获取地理位置分布统计',
    description: '返回拦截和访问的全球/中国省级地理分布图表数据。',
  })
  @ApiOkResponse({ type: WafGeoResponseDto })
  getGeo(@Query() query: MetricsQueryDto): WafGeoResponseDto {
    return this.metricsService.getGeoStats(query.range, query.mode);
  }
}
